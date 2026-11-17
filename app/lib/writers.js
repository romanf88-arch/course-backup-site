// Places a packed course can be written to. Each writer has
// write(name, Uint8Array | Blob) and close().

const PACK_FILE = /^(course-[0-9a-f]{8}\.bin|data-[0-9a-f]{8}-\d{3}\.bin|key\.json|index\.html)$/;

// Keeps files in memory. Used by tests and by tools/pack-local.mjs.
export function memoryWriter() {
  const files = new Map();
  return {
    files,
    async write(name, data) {
      files.set(name, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
    },
    async close() {},
  };
}

// Writes the course folder inside a folder the faculty member picked
// (Chrome and Edge). If the course folder already holds an earlier pack,
// the caller must pass replace: true; only files this tool made are removed.
export async function directoryWriter(parentHandle, folder, { replace = false } = {}) {
  let existing = null;
  try {
    existing = await parentHandle.getDirectoryHandle(folder);
  } catch {
    existing = null;
  }
  if (existing) {
    const old = [];
    for await (const name of existing.keys()) if (PACK_FILE.test(name)) old.push(name);
    if (old.length && !replace) {
      const error = new Error(`The folder ${folder} already holds a packed course.`);
      error.code = 'folder-exists';
      throw error;
    }
    for (const name of old) await existing.removeEntry(name);
  }
  const dir = existing || await parentHandle.getDirectoryHandle(folder, { create: true });
  return {
    async write(name, data) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async close() {},
  };
}

// Builds a .zip holding the course folder (Firefox and Safari). Encrypted
// data does not compress, so entries are stored as they are.
export function zipWriter(zipLib, folder) {
  const writer = new zipLib.ZipWriter(new zipLib.BlobWriter('application/zip'));
  return {
    async write(name, data) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      await writer.add(`${folder}/${name}`, new zipLib.BlobReader(blob), { level: 0 });
    },
    close: () => writer.close(),
  };
}
