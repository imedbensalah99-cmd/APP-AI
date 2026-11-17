import {
  MAX_BYTES, EVENT_TYPE_LIST, parseAuditExport, summarizeAudit, filterAuditEvents,
  redactForDisplay, exportAuditCsv, exportAuditJson
} from './engine.mjs';

const $ = selector => document.querySelector(selector);
const fileInput = $('#audit-file');
const importButton = $('#import-audit');
const clearButton = $('#clear-audit');
const typeFilter = $('#type-filter');
const searchInput = $('#search');
const csvButton = $('#export-csv');
const jsonButton = $('#export-json');
const status = $('#status');
const summary = $('#summary');
const tableBody = $('#events');
const countLabel = $('#visible-count');
let ledger = null;

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function cell(value, className = '') {
  const node = document.createElement('td');
  if (className) node.className = className;
  node.textContent = String(value ?? '—');
  return node;
}

function metric(label, value) {
  const card = document.createElement('div');
  card.className = 'metric';
  const number = document.createElement('strong');
  number.textContent = String(value);
  const caption = document.createElement('span');
  caption.textContent = label;
  card.append(number, caption);
  return card;
}

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentEvents() {
  if (!ledger) return [];
  return filterAuditEvents(ledger.events, { type: typeFilter.value, query: searchInput.value });
}

function render() {
  summary.replaceChildren();
  tableBody.replaceChildren();
  if (!ledger) {
    summary.append(metric('حالة السجل', 'بانتظار ملف'));
    countLabel.textContent = 'لا توجد بيانات محمّلة';
    csvButton.disabled = true;
    jsonButton.disabled = true;
    typeFilter.disabled = true;
    searchInput.disabled = true;
    clearButton.disabled = true;
    return;
  }

  const stats = summarizeAudit(ledger.events);
  summary.append(
    metric('إجمالي الأحداث', stats.total),
    metric('المهام الفريدة', stats.tasks),
    metric('أنواع الأحداث', Object.keys(stats.byType).length),
    metric('سلامة السلسلة', 'VERIFIED')
  );
  typeFilter.disabled = false;
  searchInput.disabled = false;
  csvButton.disabled = false;
  jsonButton.disabled = false;
  clearButton.disabled = false;

  const events = currentEvents();
  countLabel.textContent = 'عرض ' + events.length + ' من ' + stats.total + ' حدث';
  for (const event of events) {
    const row = document.createElement('tr');
    row.append(
      cell(event.seq),
      cell(event.at, 'mono'),
      cell(event.type),
      cell(redactForDisplay(event.taskId)),
      cell(redactForDisplay(event.detail), 'detail-cell')
    );
    tableBody.append(row);
  }
  if (!events.length) {
    const row = document.createElement('tr');
    const empty = cell('لا توجد أحداث مطابقة للبحث الحالي');
    empty.colSpan = 5;
    row.append(empty);
    tableBody.append(row);
  }
}

async function importFile() {
  const file = fileInput.files?.[0];
  if (!file) return setStatus('اختر ملف JSON أولًا.', 'error');
  if (file.size > MAX_BYTES) return setStatus('حجم الملف يتجاوز الحد الأقصى 512 KB.', 'error');
  importButton.disabled = true;
  try {
    const parsed = parseAuditExport(await file.text());
    ledger = parsed;
    typeFilter.value = 'all';
    searchInput.value = '';
    render();
    setStatus('تم التحقق من ' + parsed.events.length + ' حدثًا وسلامة سلسلة SHA-256. البيانات في الذاكرة فقط.', 'success');
  } catch (error) {
    ledger = null;
    render();
    setStatus(error instanceof Error ? error.message : 'تعذّر قراءة الملف.', 'error');
  } finally {
    importButton.disabled = false;
  }
}

importButton.addEventListener('click', importFile);
clearButton.addEventListener('click', () => {
  ledger = null;
  fileInput.value = '';
  searchInput.value = '';
  typeFilter.value = 'all';
  render();
  setStatus('تم مسح بيانات الجلسة من الواجهة.', 'info');
});
typeFilter.addEventListener('change', render);
searchInput.addEventListener('input', render);
csvButton.addEventListener('click', () => {
  if (!ledger) return;
  download('omda-audit-filtered.csv', exportAuditCsv(currentEvents(), ledger.events), 'text/csv');
});
jsonButton.addEventListener('click', () => {
  if (!ledger) return;
  download('omda-audit-verified.json', exportAuditJson(ledger.events), 'application/json');
});

for (const type of EVENT_TYPE_LIST) {
  const option = document.createElement('option');
  option.value = type;
  option.textContent = type;
  typeFilter.append(option);
}
render();
