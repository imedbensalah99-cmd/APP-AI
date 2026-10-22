import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TailoredCv } from './cvMaker';
import type { DiscoveredJob } from './discovery';
import { assessRequiredSkills } from './cvMaker';

/**
 * Only the exact user's one-page original CV layout is supported.
 * Other CVs must not be edited at hardcoded coordinates.
 * The master bytes never leave the browser and are NOT committed to GitHub.
 */
export const ORIGINAL_CV_SHA256 = 'a797bd81b23528690841a1aeeab50262fc955c9ed175e5cf6793362d5bce7806';
const DB = 'app-ai-private-cv-v1';
const STORE = 'documents';
const RECORD = 'original-pdf';

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

export async function assertOriginalPdf(bytes: Uint8Array): Promise<void> {
  if (bytes.length > 3_000_000 || bytes.length < 1000) throw new Error('Select your original one-page CV PDF (maximum 3 MB).');
  const hash = hex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  if (hash !== ORIGINAL_CV_SHA256) {
    throw new Error('This PDF does not match your verified original CV template. No layout changes were made. Choose your original "imed ben salah.pdf" file.');
  }
}

function dbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Your browser does not allow private CV storage.')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(new Error('Could not open browser CV storage.'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function saveOriginalPdf(file: File): Promise<void> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Upload the original PDF, not an image or DOCX.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  await assertOriginalPdf(bytes);
  const db = await dbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Could not save the original CV on this device.'));
    });
  } finally { db.close(); }
}
export async function getOriginalPdf(): Promise<Uint8Array | null> {
  const db = await dbOpen();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(RECORD);
      request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null);
      request.onerror = () => reject(new Error('Could not read the saved PDF.'));
    });
  } finally { db.close(); }
}
export async function deleteOriginalPdf(): Promise<void> {
  const db = await dbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Could not delete the saved PDF.'));
    });
  } finally { db.close(); }
}
export function fitLines(text: string, font: PDFFont, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) { line = candidate; continue; }
    if (line) output.push(line);
    if (output.length >= maxLines) return output;
    line = word;
    if (font.widthOfTextAtSize(word, fontSize) > maxWidth) return output;
  }
  if (line && output.length < maxLines) output.push(line);
  return output;
}

function fillOriginalSection(
  page: PDFPage, font: PDFFont, text: string,
  area: { x: number; bottom: number; width: number; height: number; baseline: number; leading: number; maxLines: number; size: number },
) {
  const lines = fitLines(text, font, area.width - 2, area.size, area.maxLines);
  page.drawRectangle({ x: area.x, y: area.bottom, width: area.width, height: area.height, color: rgb(1, 1, 1) });
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], { x: area.x + 1, y: area.baseline - i * area.leading, size: area.size, font, color: rgb(0.12, 0.12, 0.12) });
  }
}

/** Overlay only summary + skills on the EXACT original PDF; all other pixel content remains unchanged. */
export async function createOriginalLayoutCv(originalBytes: Uint8Array, cv: TailoredCv, job: DiscoveredJob): Promise<Uint8Array> {
  await assertOriginalPdf(originalBytes);
  const pdf = await PDFDocument.load(originalBytes);
  if (pdf.getPageCount() !== 1) throw new Error('Original CV must have exactly one page.');
  const page = pdf.getPage(0);
  if (Math.abs(page.getWidth() - 612) > 1 || Math.abs(page.getHeight() - 792) > 1)
    throw new Error('Unexpected source CV size: refusing to change an unknown layout.');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const data = [cv.profile.verifiedFacts, cv.profile.education, cv.profile.certifications].join('\n');
  const advised = assessRequiredSkills(job, data).filter(s => s.fit === 'direct' && cv.selectedSkills.includes(s.skill));
  const original = ['Transaction Monitoring', 'SAR/STR Filing', 'KYC/CDD', 'Sanctions and PEP Screening',
    'Case Management', 'Financial Reporting', 'Microsoft Excel (Advanced)', 'MS Office'];
  // Prioritize the exact CV-supported job skills, then preserve remaining real CV skills.
  const keywords = advised.map(x => x.skill).filter(x => !/certification/i.test(x));
  const ordered = [...new Set([...keywords, ...original])];
  const summaryBase = 'AML Analyst with hands-on experience in Qatar financial services, including transaction monitoring, KYC/CDD, SAR/STR investigation and sanctions and PEP screening. Experienced in compliance records, reporting and Qatar Central Bank correspondence. Previous experience in accounting and customer-facing sales.';
  const summary = keywords.length
    ? 'AML Analyst with documented experience in ' + keywords.slice(0, 4).join(', ') +
      '. Other financial-services work includes transaction monitoring, customer due diligence, compliance documentation, regulatory correspondence and financial reporting. Background in accounting and customer-facing sales.'
    : summaryBase;
  fillOriginalSection(page, font, summary, {
    x: 34.2, bottom: 536.4, width: 542, height: 54, baseline: 578.5,
    leading: 12.6, maxLines: 4, size: 10.25,
  });
  // Skills text region top 688.5–715.5. The next 'Languages' line begins at 717.8.
  // Keep the label and exact column/line positions: two lines maximum.
  const label = 'Skills: ';
  const maxWidth = 541;
  let selected = [...ordered];
  let text = label + selected.join(', ');
  while (selected.length > 2 && fitLines(text, font, maxWidth, 10, 3).length > 2) {
    selected.pop();
    text = label + selected.join(', ');
  }
  fillOriginalSection(page, font, text, {
    x: 34.2, bottom: 76.2, width: 545, height: 28.6, baseline: 92.3,
    leading: 12.7, maxLines: 2, size: 10,
  });
  const output = await pdf.save();
  return output;
}
