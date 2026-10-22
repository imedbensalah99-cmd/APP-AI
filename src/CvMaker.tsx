import { useEffect, useMemo, useState } from 'react';
import { assessRequiredSkills, buildAiReviewPrompt, generateCvHtml, makeInitialCv, type CvSourceProfile, type TailoredCv } from './cvMaker';
import type { DiscoveredJob } from './discovery';
import './cvMaker.css';

const BASE_KEY = 'app-ai:cv-source:v1';
const FILE_KEY = 'app-ai:cv-by-job:v1';
const PROFILE_KEY = 'app-ai:agent-profile:v1';
const NAME_KEY = 'app-ai:agent-profile-name:v1';

function read<T>(key: string, validate: (v: unknown) => v is T): T | null {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || 'null'); return validate(value) ? value : null; }
  catch { return null; }
}
function validProfile(value: unknown): value is CvSourceProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['fullName','headline','contact','verifiedFacts','education','certifications','languages']
    .every(key => typeof v[key] === 'string' && (v[key] as string).length <= 12000);
}
function validCv(value: unknown): value is TailoredCv {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.sourceUrl === 'string' && validProfile(v.profile) &&
    Array.isArray(v.selectedSkills) && v.selectedSkills.every(s => typeof s === 'string');
}

function defaultProfile(): CvSourceProfile {
  let name = '', facts = '';
  try { name = localStorage.getItem(NAME_KEY) || ''; facts = localStorage.getItem(PROFILE_KEY) || ''; }
  catch { /* Browser may block storage. */ }
  const pieces = facts.split('\n').map(x => x.trim()).filter(Boolean);
  const education = pieces.filter(x => /bachelor|degree|university|institute/i.test(x)).join('\n');
  const certifications = pieces.filter(x => /certificate|certification/i.test(x))
    .map(s => s.split(';').filter(piece => /certificate|certification/i.test(piece)).join('; ')).filter(Boolean).join('\n');
  const language = pieces.map(s => s.match(/languages?:\s*(.*)$/i)?.[1] || '').find(Boolean) || '';
  const headline = pieces[0]?.split(/\s+[—–-]\s+/)[0]?.slice(0, 110) || '';
  return {
    fullName: name, headline, contact: 'Doha, Qatar',
    verifiedFacts: facts, education, certifications, languages: language,
  };
}
function getInitialCv(job: DiscoveredJob): TailoredCv {
  const saved = read<Record<string, unknown>>(FILE_KEY, (v): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v));
  const previousCv: unknown = saved?.[job.sourceUrl];
  if (validCv(previousCv)) return previousCv;
  return makeInitialCv(job, read(BASE_KEY, validProfile) || defaultProfile());
}
const saveFileName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65) || 'tailored-cv';

export default function CvMaker({ job, onClose }: { job: DiscoveredJob; onClose: () => void }) {
  const [cv, setCv] = useState<TailoredCv>(() => getInitialCv(job));
  const [notice, setNotice] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const evidence = [cv.profile.verifiedFacts, cv.profile.education, cv.profile.certifications].join('\n');
  const advice = useMemo(() => assessRequiredSkills(job, evidence), [job, evidence]);
  const direct = advice.filter(item => item.fit === 'direct');
  const related = advice.filter(item => item.fit === 'related');
  const unsupported = advice.filter(item => item.fit === 'unsupported');

  useEffect(() => {
    try {
      const existing = read<Record<string, unknown>>(FILE_KEY, (v): v is Record<string, unknown> =>
        !!v && typeof v === 'object' && !Array.isArray(v)) || {};
      const fresh = { ...existing, [job.sourceUrl]: { ...cv, updatedAt: new Date().toISOString() } };
      localStorage.setItem(FILE_KEY, JSON.stringify(fresh));
    } catch { setNotice('Browser storage is disabled. Export your CV before leaving.'); }
  }, [cv, job.sourceUrl]);

  function updateProfile(key: keyof CvSourceProfile, value: string) {
    setCv(old => ({ ...old, profile: { ...old.profile, [key]: value.slice(0, key === 'verifiedFacts' ? 10000 : 1200) } }));
    setSourceConfirmed(false);
  }

  function saveBaseProfile() {
    if (!cv.profile.fullName.trim() || !cv.profile.verifiedFacts.trim()) {
      setNotice('Add your name and verified experience before saving your source CV.');
      return;
    }
    try { localStorage.setItem(BASE_KEY, JSON.stringify(cv.profile)); setNotice('Base CV saved privately in this browser for future job applications.'); }
    catch { setNotice('Cannot save base CV in this browser.'); }
  }
  const validForExport = !!cv.profile.fullName.trim() && !!cv.profile.verifiedFacts.trim() && sourceConfirmed;

  function render() { return generateCvHtml(cv, job); }
  function printCv() {
    if (!validForExport) { setNotice('Review your factual source CV and check the verification box first.'); return; }
    const popup = window.open('', '_blank');
    if (!popup) { setNotice('Popup blocked. Download HTML instead; open it and use Print / Save as PDF.'); return; }
    popup.document.open();
    popup.document.write(render());
    popup.document.close();
    setNotice('CV preview opened. Press Print / Save as PDF in the new tab; no application has been sent.');
  }
  function downloadHtml() {
    if (!validForExport) { setNotice('Review your factual source CV and check the verification box first.'); return; }
    const file = new Blob([render()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url;
    a.download = saveFileName(cv.profile.fullName + '-' + job.company + '-' + job.role) + '.html';
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setNotice('Your job-specific CV was saved as HTML. Open it and print to PDF if needed.');
  }
  async function askAi() {
    if (!cv.profile.verifiedFacts.trim()) { setNotice('Add your existing factual CV first.'); return; }
    try {
      await navigator.clipboard.writeText(buildAiReviewPrompt(cv, job));
      setNotice('CV and job comparison prompt copied. Open ChatGPT and paste it for an additional AI wording review; nothing was sent automatically.');
    } catch { setNotice('Clipboard permission denied. Your CV was not shared.'); }
  }

  return (
    <section className="cv-maker" aria-labelledby="cv-maker-heading">
      <div className="cv-head">
        <div><span className="eyebrow">THEME 1 · PRIVATE CV STUDIO</span>
          <h2 id="cv-maker-heading">Tailor a CV for this job</h2>
          <p><strong>{job.role}</strong> · {job.company}</p></div>
        <button type="button" className="workflow-secondary" onClick={onClose}>← Back to jobs</button>
      </div>
      <p className="cv-disclaimer">Smart skill guidance uses explainable CV-to-job comparisons, not a connected language model. A related skill is not a verified qualification. Only your own documented experience goes into the exported CV.</p>
      <div className="cv-layout">
        <div className="cv-editor">
          <h3>1 · Your verified source CV</h3>
          <p className="cv-hint">Prefilled from your private APP-AI profile when available. Review dates, titles, education and spelling. Your source CV remains in this browser, not GitHub.</p>
          <div className="cv-two">
            <label>Full name<input value={cv.profile.fullName} maxLength={120} onChange={e => updateProfile('fullName', e.target.value)} placeholder="Name on your existing CV" /></label>
            <label>Actual professional title<input value={cv.profile.headline} maxLength={120} onChange={e => updateProfile('headline', e.target.value)} placeholder="Your current or previous title (not target job)" /></label>
          </div>
          <label>Contact information<input value={cv.profile.contact} maxLength={300} onChange={e => updateProfile('contact', e.target.value)} placeholder="Doha, Qatar · phone · email" /></label>
          <label>Verified experience / responsibilities<textarea rows={7} value={cv.profile.verifiedFacts} onChange={e => updateProfile('verifiedFacts', e.target.value)} placeholder="Paste real job titles with employer and dates, plus truthful responsibility bullets. One statement per line." /></label>
          <label>Education<textarea rows={2} value={cv.profile.education} onChange={e => updateProfile('education', e.target.value)} placeholder="Degree, institution, year — only as on your CV" /></label>
          <label>Certifications<textarea rows={2} value={cv.profile.certifications} onChange={e => updateProfile('certifications', e.target.value)} placeholder="Only earned certificates" /></label>
          <label>Languages<input value={cv.profile.languages} onChange={e => updateProfile('languages', e.target.value)} placeholder="Only supported language levels" /></label>
          <button type="button" className="workflow-secondary" onClick={saveBaseProfile}>Save as base CV for future jobs</button>
        </div>
        <div className="cv-advisor">
          <h3>2 · Skills advisor</h3>
          <p className="cv-hint">Based on the words detected in this job description and your verified source CV. This is not a guarantee of eligibility.</p>
          {!advice.length && <div className="cv-none">No supported skill categories could be extracted from the listing. Read the original requirements and confirm them manually.</div>}
          {direct.map(s => <div key={s.skill} className="cv-skill">
            <label><input type="checkbox" checked={cv.selectedSkills.includes(s.skill)} onChange={e => setCv(old => ({ ...old, selectedSkills: e.target.checked ? [...old.selectedSkills, s.skill] : old.selectedSkills.filter(x => x !== s.skill) }))} />
              <strong><span className="cv-fit cv-direct">Direct match</span> {s.skill}</strong>
            </label><p>{s.evidence}</p></div>)}
          {related.map(s => <div key={s.skill} className="cv-skill">
            <strong><span className="cv-fit cv-related">Related only</span> {s.skill}</strong>
            <p>{s.guidance}</p><small>Supporting CV text: {s.evidence}</small>
          </div>)}
          {unsupported.map(s => <div key={s.skill} className="cv-skill">
            <strong><span className="cv-fit cv-missing">Not evidenced</span> {s.skill}</strong><p>{s.guidance}</p>
          </div>)}
          <div className="cv-none">Other employer requirements such as years of experience, degree level, nationality and mandatory certificates still require manual checking. The tool never changes your actual job titles or dates to match the vacancy.</div>
          <button type="button" className="workflow-secondary" onClick={askAi}>Copy prompt for ChatGPT AI review</button>
        </div>
      </div>
      <div className="cv-export">
        <h3>3 · Generate your tailored CV</h3>
        <p className="cv-hint">The printable CV prioritizes the direct skills you select while preserving your verified professional history. It never adds the related or unsupported skill names as your own qualifications.</p>
        <label className="cv-confirm"><input type="checkbox" checked={sourceConfirmed} onChange={e => setSourceConfirmed(e.target.checked)} /> I checked my name, titles, dates, skills and education against my actual CV.</label>
        <div className="cv-buttons">
          <button type="button" className="workflow-approve" disabled={!validForExport} onClick={printCv}>Preview / Save as PDF</button>
          <button type="button" className="workflow-secondary" disabled={!validForExport} onClick={downloadHtml}>Download editable HTML CV</button>
        </div>
        <p className="cv-hint">The PDF is created using your browser's Print / Save as PDF feature. Neither this action nor copying the AI prompt submits an application.</p>
        {notice && <p className="workflow-message" role="status">{notice}</p>}
      </div>
    </section>
  );
}
