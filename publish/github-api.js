// Publishing a course straight to the faculty member's GitHub repository,
// through GitHub's REST API, with a token they create once. The token is sent
// only to the GitHub API address.
import { toBase64 } from '../app/lib/crypto.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  // code: 'bad-token' | 'no-access' | 'conflict' | 'too-large' | 'network' | 'failed'
  constructor(code, status, detail = '') {
    super(`GitHub ${code} (${status}) ${detail}`.trim());
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

// GitHub's token form, filled in except for the repository, which the
// faculty member picks. Contents (write) uploads courses; Pages (read)
// shows when GitHub has finished publishing.
export function tokenUrl(owner) {
  const params = new URLSearchParams({
    name: 'Course backup',
    description: 'Lets the course backup page publish and take down courses. Under Repository access, choose only your course backup repository.',
    target_name: owner,
    expires_in: '366',
    contents: 'write',
    pages: 'read',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

async function base64Of(data) {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    if (typeof FileReader !== 'undefined') {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(data);
      });
      return url.slice(url.indexOf(',') + 1);
    }
    return toBase64(new Uint8Array(await data.arrayBuffer()));
  }
  return toBase64(data);
}

export function createClient({ token, owner, repo, apiBase = API, fetchImpl = (...a) => fetch(...a) }) {
  const root = `/repos/${owner}/${repo}`;

  async function call(method, path, body, { allow404 = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new GitHubError('network', 0, error.message);
    }
    if (allow404 && response.status === 404) return null;
    if (response.status === 401) throw new GitHubError('bad-token', 401);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const code = response.status === 403 || response.status === 404 ? 'no-access'
        : response.status === 409 || response.status === 422 ? (/too large|size/i.test(detail) ? 'too-large' : 'conflict')
          : response.status === 413 ? 'too-large' : 'failed';
      throw new GitHubError(code, response.status, detail.slice(0, 200));
    }
    return response.status === 204 ? null : response.json();
  }

  async function headState(branch) {
    const ref = await call('GET', `${root}/git/ref/heads/${branch}`);
    const commit = await call('GET', `${root}/git/commits/${ref.object.sha}`);
    return { head: ref.object.sha, tree: commit.tree.sha };
  }

  // The names of the files directly inside a folder at the top of the repository.
  async function folderFiles(treeSha, folder) {
    const top = await call('GET', `${root}/git/trees/${treeSha}`);
    const entry = top.tree.find((e) => e.path === folder && e.type === 'tree');
    if (!entry) return [];
    const inside = await call('GET', `${root}/git/trees/${encodeURIComponent(entry.sha)}?recursive=1`);
    return inside.tree.filter((e) => e.type === 'blob').map((e) => `${folder}/${e.path}`);
  }

  // One commit that sets these files under the folder and removes the folder's
  // other files. Retried when the repository moved on in the meantime.
  async function commitFolder({ folder, uploads, branch, message }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { head, tree } = await headState(branch);
      const keep = new Set(uploads.map((u) => `${folder}/${u.name}`));
      const removals = (await folderFiles(tree, folder)).filter((p) => !keep.has(p));
      const entries = [
        ...uploads.map((u) => ({ path: `${folder}/${u.name}`, mode: '100644', type: 'blob', sha: u.sha })),
        ...removals.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
      ];
      const newTree = await call('POST', `${root}/git/trees`, { base_tree: tree, tree: entries });
      const commit = await call('POST', `${root}/git/commits`, { message, tree: newTree.sha, parents: [head] });
      try {
        await call('PATCH', `${root}/git/refs/heads/${branch}`, { sha: commit.sha });
        return commit.sha;
      } catch (error) {
        if (error.code !== 'conflict' || attempt === 2) throw error;
      }
    }
    throw new GitHubError('conflict', 422);
  }

  return {
    async check() {
      const info = await call('GET', root);
      if (info.permissions && info.permissions.push === false) throw new GitHubError('no-access', 403);
      return { branch: info.default_branch || 'main' };
    },

    async publish({ folder, files, branch, message, onProgress = () => {} }) {
      const uploads = [];
      for (const [i, file] of files.entries()) {
        const blob = await call('POST', `${root}/git/blobs`, { content: await base64Of(file.data), encoding: 'base64' });
        uploads.push({ name: file.name, sha: blob.sha });
        onProgress(i + 1, files.length);
      }
      return commitFolder({ folder, uploads, branch, message });
    },

    remove({ folder, branch, message }) {
      return commitFolder({ folder, uploads: [], branch, message });
    },

    async listCourses(branch) {
      const { tree } = await headState(branch);
      const all = await call('GET', `${root}/git/trees/${tree}?recursive=1`);
      const folders = all.tree
        .filter((e) => e.type === 'blob' && /^[^/]+\/key\.json$/.test(e.path))
        .map((e) => e.path.split('/')[0]);
      const courses = [];
      for (const folder of folders) {
        let title = folder;
        try {
          const file = await call('GET', `${root}/contents/${folder}/key.json?ref=${branch}`);
          const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
          title = JSON.parse(text).title || folder;
        } catch {
          // Keep the folder name as the title.
        }
        courses.push({ folder, title });
      }
      return courses;
    },

    // Waits until GitHub Pages has published this commit. Returns 'built',
    // 'errored', or 'timeout'.
    async waitForBuild(commitSha, { interval = 5000, timeout = 300000, onTick = () => {} } = {}) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const build = await call('GET', `${root}/pages/builds/latest`, null, { allow404: true });
        const status = build ? build.status : 'waiting';
        onTick(status);
        if (build && build.commit === commitSha && status === 'built') return 'built';
        if (build && build.commit === commitSha && status === 'errored') return 'errored';
        await new Promise((r) => setTimeout(r, interval));
      }
      return 'timeout';
    },
  };
}
