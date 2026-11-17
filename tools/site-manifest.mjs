// Writes site-files.json: the files that make up a course site. The publish
// page copies these into a faculty member's repository so their site code
// matches the page they publish from. Run after changing site files:
//   node tools/site-manifest.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// Files that are not part of the site, or that faculty may have edited.
const LEAVE_OUT = [/^tests\//, /^tools\//, /^package(-lock)?\.json$/, /^\.git/, /^README\.md$/, /^site-files\.json$/];

export function siteFiles() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  return tracked.filter((path) => !LEAVE_OUT.some((rule) => rule.test(path))).sort();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('site-manifest.mjs')) {
  const files = siteFiles();
  writeFileSync(join(root, 'site-files.json'), `${JSON.stringify({ files }, null, 2)}\n`);
  console.log(`site-files.json: ${files.length} files`);
}
