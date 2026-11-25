import { scanPrompt, MAX_PROMPT_CHARS } from './engine.mjs';

const input = document.querySelector('#prompt-input');
const scanButton = document.querySelector('#scan-button');
const clearButton = document.querySelector('#clear-button');
const copyButton = document.querySelector('#copy-button');
const output = document.querySelector('#output');
const status = document.querySelector('#status');
const findingsList = document.querySelector('#findings');
const safePreview = document.querySelector('#safe-preview');
const downloadLink = document.querySelector('#download-link');
const charCount = document.querySelector('#char-count');

let currentResult = null;
let currentObjectUrl = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function clearDownload() {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  downloadLink.hidden = true;
  downloadLink.removeAttribute('href');
}

function renderFindings(result) {
  findingsList.replaceChildren();
  for (const finding of result.findings) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = finding.label;
    const detail = document.createElement('span');
    detail.textContent = finding.severity.toUpperCase() + ' · ' + finding.category + ' · characters ' + finding.start + '–' + finding.end;
    item.append(heading, detail);
    findingsList.append(item);
  }
  if (!result.findings.length) {
    const item = document.createElement('li');
    item.textContent = 'لم يتم العثور على أنماط حساسة معروفة. هذا لا يضمن خلو النص من البيانات الحساسة.';
    findingsList.append(item);
  }
}

function runScan() {
  clearDownload();
  currentResult = null;
  output.hidden = true;
  try {
    const result = scanPrompt(input.value);
    currentResult = result;
    safePreview.value = result.sanitizedPrompt;
    renderFindings(result);
    const counts = result.counts;
    setStatus('اكتمل الفحص: ' + counts.total + ' ملاحظة · Critical ' + counts.critical + ' · High ' + counts.high + ' · Medium ' + counts.medium);
    output.hidden = false;
    copyButton.disabled = false;
    const blob = new Blob([result.sanitizedPrompt], { type: 'text/plain;charset=utf-8' });
    currentObjectUrl = URL.createObjectURL(blob);
    downloadLink.href = currentObjectUrl;
    downloadLink.hidden = false;
  } catch (error) {
    setStatus(error instanceof RangeError ? 'النص يتجاوز حد الحجم المسموح.' : 'تعذّر فحص النص. تحقق من الإدخال.', true);
    copyButton.disabled = true;
  }
}

input.addEventListener('input', () => {
  charCount.textContent = input.value.length + ' / ' + MAX_PROMPT_CHARS;
});

scanButton.addEventListener('click', runScan);

clearButton.addEventListener('click', () => {
  input.value = '';
  safePreview.value = '';
  findingsList.replaceChildren();
  output.hidden = true;
  currentResult = null;
  clearDownload();
  copyButton.disabled = true;
  charCount.textContent = '0 / ' + MAX_PROMPT_CHARS;
  setStatus('تم مسح النص من الواجهة.');
  input.focus();
});

copyButton.addEventListener('click', async () => {
  if (!currentResult) return;
  try {
    await navigator.clipboard.writeText(currentResult.sanitizedPrompt);
    setStatus('تم نسخ النص المنقّح. راجعه قبل إرساله إلى أي وكيل.');
  } catch {
    setStatus('تعذّر الوصول إلى الحافظة. استخدم رابط تنزيل النص المنقّح.', true);
  }
});
