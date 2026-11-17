// The packing page: choose an export, check what students will see, then
// save the encrypted course folder and the submission tracker.
import DOMPurify from '../vendor/purify.es.mjs';
import { openZip } from '../app/lib/zip-source.js';
import { readExport } from '../app/lib/read-export.js';
import { selectContent } from '../app/lib/select.js';
import { buildCourse } from '../app/lib/build-course.js';
import { packCourse } from '../app/lib/pack-course.js';
import { directoryWriter, zipWriter } from '../app/lib/writers.js';
import { trackerRows, buildTracker, trackerFileName } from '../app/lib/tracker.js';
import { newPackId } from '../app/lib/crypto.js';
import { formatDate } from '../app/lib/dates.js';
import { PackError } from '../app/lib/errors.js';
import { mountViewer, themeButton, applyStoredTheme } from '../app/viewer/render.js';
import { createMemorySource } from '../app/viewer/memory-source.js';
import { h } from '../app/viewer/dom.js';
import { icon } from '../app/viewer/icons.js';
import { copy } from './copy.js';
import { suggestFolder, checkFolder, suggestPassword } from './naming.js';
import { WORDS } from './words.js';
import { githubRepoFromLocation, uploadUrl, folderUrl, courseUrl } from './github.js';

applyStoredTheme();
document.getElementById('theme-slot').replaceWith(themeButton());

const stepEl = document.getElementById('step');
const stepperEl = document.getElementById('stepper');
const repo = githubRepoFromLocation(location.href);
// Chrome and Edge can write a folder. Others, or ?zip=1 in the address, get a .zip.
const canWriteFolders = typeof window.showDirectoryPicker === 'function' &&
  !new URLSearchParams(location.search).has('zip');
const MB = 1e6;

const state = {
  step: 1, file: null, zip: null, raw: null, exclude: new Set(),
  folder: '', passwordMode: 'suggested', suggested: suggestPassword(WORDS), own: '', name: '', email: '',
};

// ---------- Helpers ----------

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyText(text, button, doneLabel) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const before = button.textContent;
  button.textContent = doneLabel;
  setTimeout(() => { button.textContent = before; }, 2000);
}

function notice(text, kind = 'info', iconName) {
  return h('div', { class: `notice${kind === 'warn' ? ' notice-warn' : ''}` },
    icon(iconName || (kind === 'warn' ? 'warn' : 'info')), h('p', { text }));
}

function password() {
  if (state.passwordMode === 'none') return null;
  return state.passwordMode === 'own' ? state.own : state.suggested;
}

function selectionFor(exclude) {
  const now = new Date();
  const selection = selectContent(state.raw, { now, exclude });
  return buildCourse(state.raw, selection, {
    packId: newPackId(), instructor: { name: state.name.trim(), email: state.email.trim() }, now,
  });
}

function renderStepper() {
  stepperEl.replaceChildren(...copy.steps.map((label, i) => {
    const n = i + 1;
    const status = n < state.step ? 'done' : n === state.step ? 'current' : 'todo';
    return h('li', { class: `step-${status}`, 'aria-current': status === 'current' ? 'step' : null },
      h('span', { class: 'step-num', 'aria-hidden': 'true' }, status === 'done' ? icon('check') : String(n)),
      h('span', { class: 'step-label' }, h('span', { class: 'visually-hidden', text: `${copy.stepOf(n, 3)}: ` }), label));
  }));
}

let firstShow = true;

function show(step, nodes) {
  state.step = step;
  renderStepper();
  stepEl.replaceChildren(...nodes.filter(Boolean));
  const heading = stepEl.querySelector('h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    // Move focus to the new step, but not when the page first opens.
    if (!firstShow) heading.focus();
  }
  firstShow = false;
}

// ---------- Step 1 ----------

async function readFile(file, status, error) {
  error.hidden = true;
  status.textContent = copy.choose.reading;
  try {
    const zip = await openZip(window.zip, file);
    const raw = await readExport(zip);
    Object.assign(state, {
      file, zip, raw, exclude: new Set(), folder: suggestFolder(raw.code, raw.title),
    });
    status.textContent = '';
    renderStep2();
  } catch (e) {
    status.textContent = '';
    error.textContent = e instanceof PackError
      ? (e.code === 'not-canvas' ? copy.choose.notCanvas : copy.choose.notZip)
      : copy.choose.other(e.message);
    error.hidden = false;
  }
}

function renderStep1() {
  const t = copy.choose;
  const input = h('input', { type: 'file', accept: '.imscc,.zip', id: 'export-file', class: 'visually-hidden' });
  const status = h('p', { class: 'muted', role: 'status' });
  const error = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });
  const zone = h('div', { class: 'dropzone' },
    icon('upload'),
    h('p', { class: 'dropzone-title', text: t.drop }),
    h('p', { class: 'muted', text: t.or }),
    input,
    h('label', { class: 'btn btn-primary', for: 'export-file', text: t.button }));
  input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0], status, error); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readFile(file, status, error);
  });
  show(1, [h('div', { class: 'card' },
    h('h2', { text: t.title }),
    h('p', { text: t.text }),
    zone, status, error,
    h('p', { class: 'muted small', text: t.how }))]);
}

// ---------- Step 2 ----------

function countsList(report) {
  const c = report.counts;
  const t = copy.check.counts;
  const rows = Object.entries(c).filter(([, n]) => n > 0).map(([key, n]) => h('li', {}, icon('check'), t[key](n)));
  return h('ul', { class: 'tally' }, rows.length ? rows : h('li', { class: 'muted', text: copy.check.nothing }));
}

function leftOutList(report) {
  const o = copy.check.out;
  const lo = report.leftOut;
  const rows = [
    report.quizzesStripped ? o.quizzes(report.quizzesStripped) : null,
    lo.unpublished ? o.unpublished(lo.unpublished) : null,
    lo.locked ? o.locked(lo.locked) : null,
    lo.unlinked ? o.unlinked(lo.unlinked) : null,
    lo.quizFiles ? o.quizFiles(lo.quizFiles) : null,
    lo.chosen.length ? o.chosen(lo.chosen.length) : null,
  ].filter(Boolean);
  return h('ul', { class: 'tally tally-out' }, rows.map((text) => h('li', {}, icon('close'), text)));
}

function checkboxList(items, label) {
  return h('ul', { class: 'check-list' }, items.map((item) => {
    const id = `keep-${item.id}`;
    const box = h('input', { type: 'checkbox', id, checked: !state.exclude.has(item.id) });
    box.addEventListener('change', () => {
      if (box.checked) state.exclude.delete(item.id); else state.exclude.add(item.id);
      refreshSummary();
    });
    return h('li', {}, box, h('label', { for: id, text: label(item) }));
  }));
}

let summaryEl = null;
let continueBtn = null;
let previewBtn = null;

function refreshSummary() {
  const built = selectionFor(state.exclude);
  const { report } = built;
  const big = report.estimatedBytes > 1_000_000_000;
  const empty = report.warnings.includes('empty');
  summaryEl.replaceChildren(...[
    h('div', { class: 'two-col' },
      h('div', {}, h('h3', { text: copy.check.included }), countsList(report)),
      h('div', {}, h('h3', { text: copy.check.leftOut }), leftOutList(report))),
    h('p', { class: 'muted', text: copy.check.size(Math.max(1, Math.round(report.estimatedBytes / MB))) }),
    big ? notice(copy.check.tooBig, 'warn') : null].filter(Boolean));
  continueBtn.disabled = big || empty;
  previewBtn.disabled = empty;
  return built;
}

function folderField() {
  const t = copy.check;
  const input = h('input', { type: 'text', id: 'folder', value: state.folder, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'folder-hint folder-link folder-error' });
  const link = h('p', { id: 'folder-link', class: 'hint' });
  const error = h('p', { id: 'folder-error', class: 'error', hidden: true });
  const update = () => {
    state.folder = input.value.trim();
    const problem = checkFolder(state.folder);
    link.replaceChildren(t.linkPreview, ' ', h('code', { text: courseUrl(location.href, state.folder || '…') }));
    error.hidden = !problem;
    error.textContent = problem ? t.folderErrors[problem] : '';
    if (problem) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', update);
  update();
  return h('div', { class: 'field' },
    h('label', { for: 'folder', text: t.folder }),
    h('p', { id: 'folder-hint', class: 'hint', text: t.folderHint }),
    input, link, error);
}

function passwordField() {
  const t = copy.check;
  const suggestedText = h('code', { class: 'suggested-password', text: state.suggested });
  const own = h('input', { type: 'text', id: 'own-password', value: state.own, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'own-warning' });
  const ownWarning = h('p', { id: 'own-warning', class: 'hint' });
  const noneWarning = notice(t.passwordNoneWarn, 'warn');
  const option = (value, label, extra) => {
    const id = `pw-${value}`;
    const radio = h('input', { type: 'radio', name: 'pw-mode', id, value, checked: state.passwordMode === value });
    radio.addEventListener('change', () => { state.passwordMode = value; sync(); });
    return h('div', { class: 'option' }, radio, h('div', { class: 'option-body' }, h('label', { for: id }, label), extra));
  };
  const again = h('button', { type: 'button', class: 'btn btn-small', text: t.passwordNew, onclick: () => {
    state.suggested = suggestPassword(WORDS);
    suggestedText.textContent = state.suggested;
  } });
  const sync = () => {
    own.disabled = state.passwordMode !== 'own';
    noneWarning.hidden = state.passwordMode !== 'none';
    const value = own.value;
    ownWarning.textContent = state.passwordMode === 'own' && value && value.trim().length < 12 ? t.passwordShort : '';
  };
  own.addEventListener('input', () => { state.own = own.value; sync(); });
  const fieldset = h('fieldset', { class: 'field' },
    h('legend', { text: t.password }),
    option('suggested', t.passwordSuggested, h('div', { class: 'option-row' }, suggestedText, again)),
    option('own', t.passwordOwn, h('div', {}, h('label', { class: 'visually-hidden', for: 'own-password', text: t.passwordOwnLabel }), own, ownWarning)),
    option('none', t.passwordNone, noneWarning));
  sync();
  return fieldset;
}

function personFields() {
  const t = copy.check;
  const name = h('input', { type: 'text', id: 'person-name', value: state.name, autocomplete: 'name' });
  const email = h('input', { type: 'email', id: 'person-email', value: state.email, autocomplete: 'email' });
  name.addEventListener('input', () => { state.name = name.value; });
  email.addEventListener('input', () => { state.email = email.value; });
  return h('fieldset', { class: 'field' },
    h('legend', { text: t.you }),
    h('p', { class: 'hint', text: t.youHint }),
    h('div', { class: 'two-col' },
      h('div', {}, h('label', { for: 'person-name', class: 'label', text: t.name }), name),
      h('div', {}, h('label', { for: 'person-email', class: 'label', text: t.email }), email)));
}

function openPreview(built) {
  const dialog = document.getElementById('preview');
  const container = h('div', { id: 'preview-app' });
  let viewer = null;
  const close = () => {
    if (viewer) viewer.destroy();
    history.replaceState(null, '', location.pathname + location.search);
    document.title = `${copy.pageTitle} | ${copy.brand}`;
    dialog.close();
    previewBtn.focus();
  };
  dialog.replaceChildren(
    h('div', { class: 'preview-bar' },
      h('p', { id: 'preview-title', text: copy.check.previewTitle }),
      h('button', { type: 'button', class: 'btn btn-small', onclick: close }, icon('close'), copy.check.closePreview)),
    container);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); }, { once: true });
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  dialog.showModal();
  viewer = mountViewer(container, { course: built.course, files: createMemorySource(state.zip, built), now: new Date(), DOMPurify });
  dialog.querySelector('.preview-bar button').focus();
}

async function saveTracker() {
  const rows = trackerRows(state.raw);
  const wb = buildTracker(window.ExcelJS, { courseTitle: state.raw.title, rows, instructions: copy.trackerSheet });
  const buffer = await wb.xlsx.writeBuffer();
  const name = trackerFileName(state.raw.code, state.raw.title);
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return name;
}

function renderStep2() {
  const t = copy.check;
  const baseline = selectionFor(new Set());
  const { report } = baseline;
  const kindLabel = (kind) => t.kinds[kind] || kind;
  const empty = report.warnings.includes('empty');
  const formError = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });

  summaryEl = h('div', { class: 'summary', 'aria-live': 'polite' });
  continueBtn = h('button', { type: 'button', class: 'btn btn-primary', text: copy.next });
  previewBtn = h('button', { type: 'button', class: 'btn' }, icon('eye'), t.preview);
  previewBtn.addEventListener('click', () => openPreview(selectionFor(state.exclude)));
  continueBtn.addEventListener('click', () => {
    const folderProblem = checkFolder(state.folder);
    if (folderProblem) {
      document.getElementById('folder').focus();
      return;
    }
    if (state.passwordMode === 'own' && !state.own.trim()) {
      formError.textContent = t.passwordEmpty;
      formError.hidden = false;
      document.getElementById('own-password').focus();
      return;
    }
    renderStep3();
  });

  const future = report.future.length ? h('section', { class: 'card sub-card' },
    h('h3', { text: t.futureTitle }),
    h('p', { text: t.futureText }),
    checkboxList(report.future, (f) => t.futureItem(f.title, kindLabel(f.kind), formatDate(f.unlockAt)))) : null;
  const big = report.estimatedBytes > 500_000_000 ? h('section', { class: 'card sub-card' },
    h('h3', { text: t.bigTitle }),
    h('p', { text: t.bigText }),
    checkboxList(report.largest, (f) => `${f.name} (${Math.round(f.size / MB)} MB)`)) : null;
  const trackerOnly = h('section', { class: 'card sub-card tracker-only' },
    h('h3', { text: t.trackerOnlyTitle }),
    h('p', { text: t.trackerOnlyText }),
    h('button', { type: 'button', class: 'btn', onclick: () => saveTracker() }, icon('download'), t.trackerOnly));

  const nodes = [h('div', { class: 'card' },
    h('h2', { text: t.title }),
    h('p', { class: 'course-name', text: state.raw.title }),
    empty ? h('div', {}, h('h3', { text: t.emptyTitle }), notice(t.emptyText, 'warn')) : null,
    folderField(),
    passwordField(),
    personFields(),
    summaryEl),
  future, big,
  formError,
  h('div', { class: 'actions step-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => renderStep1() }, icon('left'), copy.back),
    previewBtn, continueBtn),
  trackerOnly];
  show(2, nodes);
  refreshSummary();
}

// ---------- Step 3 ----------

function confirmReplace(folder) {
  const dialog = document.getElementById('confirm');
  return new Promise((resolve) => {
    const done = (answer) => { dialog.close(); resolve(answer); };
    dialog.replaceChildren(
      h('p', { id: 'confirm-text', text: copy.save.replaceAsk(folder) }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', text: copy.save.replace, onclick: () => done(true) }),
        h('button', { type: 'button', class: 'btn', text: copy.save.cancel, onclick: () => done(false) })));
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    dialog.showModal();
  });
}

function resultsView({ savedText, trackerName, built }) {
  const t = copy.save;
  const link = courseUrl(location.href, state.folder);
  const linkBtn = h('button', { type: 'button', class: 'btn btn-small' }, icon('copy'), t.copyLink);
  linkBtn.addEventListener('click', () => copyText(link, linkBtn, t.copied));
  const email = t.email({ title: state.raw.title, link, password: password(), name: state.name.trim() });
  const emailBox = h('textarea', { class: 'email-box', rows: email.split('\n').length + 3, readonly: true, 'aria-label': t.emailTitle });
  emailBox.value = email;
  const emailBtn = h('button', { type: 'button', class: 'btn' }, icon('copy'), t.copyEmail);
  emailBtn.addEventListener('click', () => copyText(email, emailBtn, t.copied));
  const r = built.report;

  return [
    notice(savedText, 'info', 'check'),
    notice(t.trackerSaved(trackerName), 'info', 'download'),
    h('p', {}, h('button', { type: 'button', class: 'btn btn-small', onclick: () => saveTracker() }, icon('download'), t.trackerAgain)),
    h('section', { class: 'card' },
      h('h3', { text: t.uploadTitle }),
      h('ol', { class: 'upload-steps' },
        h('li', {}, h('p', { text: repo ? t.upload1 : t.upload1Unknown }),
          repo ? h('a', { class: 'btn btn-primary', href: uploadUrl(repo), target: '_blank', rel: 'noopener' }, icon('external'), t.uploadButton) : null),
        h('li', {}, h('p', { text: t.upload2(state.folder) })),
        h('li', {}, h('p', { text: t.upload3 })),
        h('li', {}, h('p', { text: t.upload4 }),
          h('div', { class: 'option-row' }, h('a', { href: link, target: '_blank', rel: 'noopener', text: link }), linkBtn)))),
    repo ? h('section', { class: 'card sub-card' },
      h('h3', { text: t.replacingTitle }),
      h('p', { text: t.replacingText }),
      h('a', { class: 'btn', href: folderUrl(repo, state.folder), target: '_blank', rel: 'noopener' }, icon('external'), t.replacingButton)) : null,
    h('section', { class: 'card' },
      h('h3', { text: t.emailTitle }),
      h('p', { class: 'muted', text: t.emailText }),
      emailBox,
      h('p', {}, emailBtn)),
    h('details', { class: 'card report' },
      h('summary', { text: t.reportTitle }),
      h('div', { class: 'two-col' },
        h('div', {}, h('h4', { text: copy.check.included }), countsList(r)),
        h('div', {}, h('h4', { text: copy.check.leftOut }), leftOutList(r))),
      r.tools.length ? [h('p', { text: t.reportTools }), h('ul', {}, r.tools.map((x) => h('li', { text: x })))] : null,
      r.everyone.length ? [h('p', { text: t.reportEveryone }), h('ul', {}, r.everyone.map((x) => h('li', { text: x.title })))] : null,
      r.canvasLinks.length ? [h('p', { text: t.reportCanvas }), h('ul', {}, r.canvasLinks.map((x) => h('li', {}, h('strong', { text: x.itemTitle }), `: ${x.url}`)))] : null),
    h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, t.another)),
  ];
}

function renderStep3() {
  const t = copy.save;
  const status = h('p', { role: 'status', class: 'muted' });
  const bar = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': t.progressLabel });
  const error = h('p', { class: 'notice notice-warn', role: 'alert', hidden: true });
  const results = h('div', { class: 'results-area' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('download'), canWriteFolders ? t.folderButton : t.zipButton);
  const backBtn = h('button', { type: 'button', class: 'btn', onclick: () => renderStep2() }, icon('left'), copy.back);

  saveBtn.addEventListener('click', async () => {
    error.hidden = true;
    let out;
    try {
      if (canWriteFolders) {
        let parent;
        try {
          parent = await window.showDirectoryPicker({ id: 'course-backup', mode: 'readwrite' });
        } catch (e) {
          if (e.name === 'AbortError') return;
          throw e;
        }
        try {
          out = await directoryWriter(parent, state.folder);
        } catch (e) {
          if (e.code !== 'folder-exists') throw e;
          if (!(await confirmReplace(state.folder))) return;
          out = await directoryWriter(parent, state.folder, { replace: true });
        }
      } else {
        out = zipWriter(window.zip);
      }
      saveBtn.disabled = true;
      backBtn.disabled = true;
      bar.hidden = false;
      const built = selectionFor(state.exclude);
      await packCourse({
        zip: state.zip, built, password: password(), out,
        onProgress: (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 100;
          bar.value = pct;
          status.textContent = t.working(pct);
        },
      });
      let savedText = t.savedFolder(state.folder);
      if (!canWriteFolders) {
        const blob = await out.close();
        download(blob, `${state.folder}.zip`);
        savedText = t.savedZip(`${state.folder}.zip`, state.folder);
      }
      const trackerName = await saveTracker();
      status.textContent = '';
      bar.hidden = true;
      saveBtn.hidden = true;
      backBtn.hidden = true;
      results.replaceChildren(...resultsView({ savedText, trackerName, built }).filter(Boolean));
      results.querySelector('.notice').setAttribute('tabindex', '-1');
      results.querySelector('.notice').focus();
    } catch (e) {
      saveBtn.disabled = false;
      backBtn.disabled = false;
      bar.hidden = true;
      status.textContent = '';
      error.textContent = t.failed(e.message);
      error.hidden = false;
    }
  });

  show(3, [h('div', { class: 'card' },
    h('h2', { text: t.title }),
    h('p', { class: 'course-name', text: state.raw.title }),
    h('p', { text: canWriteFolders ? t.folderText : t.zipText }),
    h('div', { class: 'actions' }, backBtn, saveBtn),
    bar, status, error),
  results]);
}

renderStep1();
