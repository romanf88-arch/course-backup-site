// Development page: opens a local export in the viewer without packing it.
import DOMPurify from '../vendor/purify.es.mjs';
import { openZip } from './lib/zip-source.js';
import { readExport } from './lib/read-export.js';
import { selectContent } from './lib/select.js';
import { buildCourse } from './lib/build-course.js';
import { mountViewer } from './viewer/render.js';
import { createMemorySource } from './viewer/memory-source.js';

const status = document.getElementById('status');

async function open(blob) {
  status.textContent = 'Reading the export…';
  const zip = await openZip(globalThis.zip, blob);
  const raw = await readExport(zip);
  const now = new Date();
  const built = buildCourse(raw, selectContent(raw, { now, exclude: new Set() }), {
    packId: 'devprev0', instructor: { name: 'Dr. Example', email: 'instructor@example.edu' }, now,
  });
  window.__built = built;
  mountViewer(document.getElementById('app'), {
    course: built.course, files: createMemorySource(zip, built), now, DOMPurify,
  });
}

const source = new URLSearchParams(location.search).get('export');
if (source) {
  fetch(source).then((r) => r.blob()).then(open).catch((e) => { status.textContent = String(e); });
}
document.getElementById('pick').addEventListener('change', (e) => {
  if (e.target.files[0]) open(e.target.files[0]).catch((err) => { status.textContent = String(err); });
});
