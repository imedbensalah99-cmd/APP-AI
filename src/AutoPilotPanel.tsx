import { useEffect, useState } from 'react';
import { prepareAutopilot, assessForAutopilot, type JobDecision } from './autopilot';
import { searchJobFeeds, uniqueLeads, type DiscoveredJob, type ReviewDraft } from './discovery';
import { makeInitialCv, type TailoredCv, type CvSourceProfile } from './cvMaker';
import type { JobApplication } from './types';
import { channelForJob } from './applicationChannel';
import { saveOriginalPdf, getOriginalPdf, deleteOriginalPdf, createOriginalLayoutCv } from './originalCvPdf';
import './autopilot.css';

const QUEUE_KEY = 'app-ai:autopilot-queue:v1';
const DECLINED_KEY = 'app-ai:autopilot-trashed:v1';
const CV_KEY = 'app-ai:cv-by-job:v1';
const PROFILE_KEY = 'app-ai:agent-profile:v1';
const NAME_KEY = 'app-ai:agent-profile-name:v1';
const BASE_CV_KEY = 'app-ai:cv-source:v1';

function stored<T>(key: string, fallback: T, check: (x: unknown) => x is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj: unknown = JSON.parse(raw);
    return check(obj) ? obj : fallback;
  } catch { return fallback; }
}
const strings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= 1000 && x.every(y => typeof y === 'string' && y.length < 2200);
const draftsOk = (x: unknown): x is ReviewDraft[] =>
  Array.isArray(x) && x.length <= 300 && x.every(y =>
    !!y && typeof y === 'object' && typeof y.id === 'string' &&
    !!y.job && typeof y.job.sourceUrl === 'string' &&
    typeof y.body === 'string' && ['Draft', 'Handoff', 'Sent-confirmed'].includes(y.status));
const jobOk = (x: unknown): x is DiscoveredJob =>
  !!x && typeof x === 'object' && typeof (x as DiscoveredJob).id === 'string' &&
  typeof (x as DiscoveredJob).role === 'string' && typeof (x as DiscoveredJob).sourceUrl === 'string' &&
  (x as DiscoveredJob).sourceUrl.startsWith('https://');
const cvMapOk = (x: unknown): x is Record<string, TailoredCv> => !!x && typeof x === 'object' && !Array.isArray(x);
const cvOk = (x: unknown): x is CvSourceProfile => !!x && typeof x === 'object' &&
  typeof (x as CvSourceProfile).fullName === 'string' &&
  typeof (x as CvSourceProfile).verifiedFacts === 'string';

function getCv(): CvSourceProfile {
  const base = stored(BASE_CV_KEY, null as CvSourceProfile | null,
    (v): v is CvSourceProfile | null => v === null || cvOk(v));
  const fallbackName = (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } })();
  const fallbackFacts = (() => { try { return localStorage.getItem(PROFILE_KEY) || ''; } catch { return ''; } })();
  return {
    fullName: base?.fullName?.trim() || fallbackName,
    headline: base?.headline || 'Professional',
    contact: base?.contact || 'Doha, Qatar',
    verifiedFacts: base?.verifiedFacts?.trim() || fallbackFacts,
    education: base?.education || '',
    certifications: base?.certifications || '',
    languages: base?.languages || '',
  };
}
function saveCvs(cvs: Record<string, TailoredCv>) {
  const previous = stored(CV_KEY, {} as Record<string, TailoredCv>, cvMapOk);
  // Keep any CV revisions already edited by the user.
  localStorage.setItem(CV_KEY, JSON.stringify({ ...cvs, ...previous }));
}
function currentCv(job: DiscoveredJob) {
  const existing = stored(CV_KEY, {} as Record<string, TailoredCv>, cvMapOk);
  const old = existing[job.sourceUrl];
  return old && cvOk(old.profile) ? old : makeInitialCv(job, getCv());
}
function publicList(value: unknown): DiscoveredJob[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { jobs?: unknown }).jobs))
    throw new Error('Source list is invalid');
  return (value as { jobs: unknown[] }).jobs.filter(jobOk);
}
function readableDate(when: string) {
  const time = new Date(when);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleDateString();
}

export default function AutoPilotPanel({ applications, onConfirmedSend }: {
  applications: JobApplication[];
  onConfirmedSend: (job: DiscoveredJob) => void;
}) {
  const [queue, setQueue] = useState<ReviewDraft[]>(() => stored(QUEUE_KEY, [] as ReviewDraft[], draftsOk));
  const [declined, setDeclined] = useState<string[]>(() => stored(DECLINED_KEY, [] as string[], strings));
  const [decisions, setDecisions] = useState<JobDecision[]>([]);
  const [active, setActive] = useState('');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');
  const [lastSource, setLastSource] = useState('');
  const [tab, setTab] = useState<'review' | 'found'>('review');
  const [email, setEmail] = useState('');
  const [emailChecked, setEmailChecked] = useState(false);
  const [originalCvReady, setOriginalCvReady] = useState(false);
  const current = queue.find(d => d.id === active) || queue.find(d => d.status !== 'Sent-confirmed') || queue[0];
  const currentChannel = current ? channelForJob(current.job) : null;
  const candidateEmail = email.trim() || (currentChannel?.kind === 'email_candidate' ? currentChannel.email : '');
  const unsent = queue.filter(d => d.status !== 'Sent-confirmed');
  const sent = queue.filter(d => d.status === 'Sent-confirmed');

  useEffect(() => {
    getOriginalPdf().then(bytes => setOriginalCvReady(!!bytes)).catch(() => setOriginalCvReady(false));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
    catch { setNote('Storage blocked: save a backup or use a normal browser tab.'); }
  }, [queue]);
  useEffect(() => {
    try { localStorage.setItem(DECLINED_KEY, JSON.stringify(declined)); }
    catch { setNote('Storage blocked: trashed job history may not persist.'); }
  }, [declined]);

  async function runAgent() {
    if (working) return;
    const cv = getCv();
    if (!cv.fullName.trim() || !cv.verifiedFacts.trim()) {
      setNote('Your verified CV needs to be loaded once. Open CV Profile below, import your existing CV facts, then press Run Agent. No invented information will be used.');
      const section = document.getElementById('profile-tools');
      if (section instanceof HTMLDetailsElement) section.open = true;
      document.getElementById('agent-heading')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setWorking(true);
    setNote('Searching public job sources, screening vacancies and preparing matching applications…');
    const terms = ['compliance', 'AML', 'finance', 'operations', 'customer support'];
    const answers = await Promise.allSettled(terms.map(term => searchJobFeeds(fetch, term)));
    let found = answers.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    let source = 'public live search API';
    if (!found.length) {
      try {
        const response = await fetch(import.meta.env.BASE_URL + 'jobs-cache.json?t=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('No snapshot is accessible.');
        found = publicList(await response.json());
        source = 'last scheduled public snapshot (not live)';
      } catch (error) {
        setNote('Public jobs could not be loaded. ' + (error instanceof Error ? error.message : 'Source unavailable.') + ' No imaginary vacancies were created.');
        setWorking(false);
        return;
      }
    }
    const unique = uniqueLeads(found, applications).filter(j => !declined.includes(j.sourceUrl));
    const prepared = prepareAutopilot(unique, cv, queue, applications);
    const novel = prepared.newDrafts.slice(0, 35);
    try { saveCvs(prepared.tailoredCvs); }
    catch { setNote('Your browser blocked CV storage; documents may need regenerating.'); }
    if (novel.length) {
      setQueue(old => [...novel, ...old]);
      setActive(novel[0].id);
    }
    setDecisions(prepared.decisions);
    setTab('review');
    setLastSource(source);
    const related = prepared.decisions.filter(d => d.suitability === 'review').length;
    const excluded = prepared.decisions.filter(d => d.suitability === 'exclude').length;
    setNote('Checked ' + unique.length + ' public job leads via ' + source +
      '. Prepared ' + novel.length + ' new application(s) and tailored CVs automatically; ' +
      related + ' need review and ' + excluded + ' were excluded. No emails were sent.');
    setWorking(false);
  }


  async function uploadOriginalCv(file: File | undefined) {
    if (!file) return;
    try {
      await saveOriginalPdf(file);
      setOriginalCvReady(true);
      setNote('Original CV template saved privately in this browser. Same-layout PDF versions can now be created.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not validate original CV.');
    }
  }

  async function clearOriginalCv() {
    if (!window.confirm('Delete the stored CV template from this device?')) return;
    try {
      await deleteOriginalPdf();
      setOriginalCvReady(false);
      setNote('Original CV template removed from this browser.');
    } catch {
      setNote('Could not delete private CV.');
    }
  }

  async function downloadSameLayoutCv(job: DiscoveredJob) {
    try {
      const original = await getOriginalPdf();
      if (!original) {
        setOriginalCvReady(false);
        setNote('Upload the exact original imed ben salah.pdf once below. APP-AI cannot truthfully promise identical formatting without the original.');
        document.getElementById('original-cv-setup')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const pdfBytes = await createOriginalLayoutCv(original, currentCv(job), job);
      const url = URL.createObjectURL(new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }));
      const name = (job.company + '-' + job.role).replace(/[^a-z0-9-]+/gi, '-').slice(0, 65);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Imed-Ben-Salah-' + name + '-CV.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNote('Original-layout PDF generated. Only summary and supported skills were adapted. Check it before applying.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Failed to create the original-format CV.');
    }
  }

  function choose(draft: ReviewDraft) {
    setActive(draft.id);
    const channel = channelForJob(draft.job);
    setEmail(draft.recipient || (channel.kind === 'email_candidate' ? channel.email : ''));
    setEmailChecked(false);
    setTab('review');
  }
  function modifyBody(body: string) {
    if (!current) return;
    setQueue(old => old.map(item => item.id === current.id
      ? { ...item, body: body.slice(0, 12000) } : item));
  }
  function trash() {
    if (!current || !window.confirm('Trash this job application and exclude it from future automatic drafts?')) return;
    setDeclined(old => [...new Set([...old, current.job.sourceUrl])]);
    setQueue(old => old.filter(x => x.id !== current.id));
    setActive('');
    setNote('Trashed. This job will not be drafted again on your next search.');
  }
  function approveHandoff() {
    if (!current) return;
    // An unverified email is never used without the user's explicit confirmation.
    const recipient = emailChecked ? candidateEmail.trim() : '';
    if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setNote('This email is invalid; check the official employer source.');
      return;
    }
    const route = recipient ? 'email draft' : 'job application website';
    if (!window.confirm('Open ' + route + ' for ' + current.job.company +
      '? APP-AI does not send emails, attach CVs, or submit applications. You must finish these steps yourself.')) return;
    if (recipient) {
      const lines = current.body.split('\n');
      const subjectLine = lines[0]?.startsWith('Subject: ');
      const subject = subjectLine ? lines[0].slice(9) : 'Application – ' + current.job.role;
      const body = subjectLine ? lines.slice(1).join('\n') : current.body;
      window.location.href = 'mailto:' + recipient + '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
    } else {
      window.open(current.job.sourceUrl, '_blank', 'noopener,noreferrer');
    }
    setQueue(old => old.map(d => d.id === current.id ? { ...d, recipient, status: 'Handoff' } : d));
    setNote('Opened ' + route + '. Nothing was sent by APP-AI.');
  }
  function markSubmitted() {
    if (!current || current.status !== 'Handoff') return;
    if (!window.confirm('Have you actually sent the email with the CV attached or completed the employer form? APP-AI cannot verify this.')) return;
    setQueue(old => old.map(d => d.id === current.id ? { ...d, status: 'Sent-confirmed' } : d));
    onConfirmedSend(current.job);
    setNote('Marked submitted based on your confirmation. No independent proof of delivery is available.');
  }
  function previewCv() {
    if (!current) return;
    void downloadSameLayoutCv(current.job);
  }

  return (
    <section id="autopilot" className="autopilot" aria-labelledby="autopilot-title">
      <div className="auto-head">
        <div><span className="eyebrow">APP-AI · AUTOMATED ASSISTANT</span><h2 id="autopilot-title">One button. Applications ready for review.</h2>
          <p>Find opportunities, screen CV evidence, and prepare tailored drafts and CVs automatically. You decide what to approve or trash.</p></div>
        <span className="auto-pill">Private CV · No paid API</span>
      </div>
      <button type="button" className="auto-run" onClick={runAgent} disabled={working}>
        {working ? '⌛ Searching, matching & drafting…' : '✦ RUN JOB AGENT'}
      </button>
      <p className="auto-fine">Searches public remote-job feeds and falls back to the last daily snapshot. It cannot yet search every on-site Doha employer or securely send email from this public website.</p>
      <div id="original-cv-setup" className="auto-template">
        <div><strong>CV الأصلي — نفس التنسيق</strong>
          <small>{originalCvReady ? 'ملف الـPDF الأصلي محفوظ على هذا الجهاز.' : 'ارفع PDF الأصلي مرة واحدة لإنشاء نسخ مخصصة بنفس الصفحة.'}</small>
        </div>
        <label className="auto-upload">اختيار الـCV الأصلي PDF
          <input type="file" accept="application/pdf,.pdf"
            onChange={e => { void uploadOriginalCv(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {originalCvReady && <button type="button" className="auto-clear" onClick={() => void clearOriginalCv()}>إزالة الملف المحفوظ</button>}
      </div>
      {note && <div className="auto-message" role="status">{note}</div>}
      <div className="auto-metrics">
        <div><strong>{unsent.length}</strong><small>Drafts to review</small></div>
        <div><strong>{decisions.filter(d => d.suitability === 'review').length}</strong><small>Needs checking</small></div>
        <div><strong>{declined.length}</strong><small>Trashed / excluded</small></div>
        <div><strong>{sent.length}</strong><small>User-confirmed sent</small></div>
      </div>
      <nav className="auto-tabs" aria-label="Automated job agent views">
        <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')} type="button">Ready to review ({unsent.length})</button>
        <button className={tab === 'found' ? 'on' : ''} onClick={() => setTab('found')} type="button">Search results ({decisions.length})</button>
      </nav>
      {tab === 'found' ? (
        <div className="auto-found">
          {decisions.length === 0 && <p>Press RUN JOB AGENT to search online and assess opportunities.</p>}
          {decisions.map(d => <article className="auto-result" key={d.job.id}>
            <div><strong>{d.job.role}</strong><small>{d.job.company} · {d.job.location}</small>
              <span>{d.explanation}</span>
              <span className="auto-contact-tag">{channelForJob(d.job).kind === 'email_candidate' ? 'إيميل مذكور في الإعلان — غير موثّق' : 'تقديم عبر الموقع فقط'}</span>
              <a target="_blank" rel="noopener noreferrer" href={d.job.sourceUrl}>مصدر الوظيفة ↗</a>
              <button type="button" className="auto-source-cv" onClick={() => void downloadSameLayoutCv(d.job)}>CV مخصص بنفس التصميم</button></div>
            <em className={'auto-' + d.suitability}>{d.suitability === 'prepare' ? 'CV match' : d.suitability === 'review' ? 'Review needed' : 'Excluded'}</em>
          </article>)}
        </div>
      ) : (
        <div className="auto-body">
          <div className="auto-queue">
            {!queue.length && <p className="auto-empty">No applications prepared yet. Press RUN JOB AGENT. The agent will prepare only jobs that meet its CV matching checks.</p>}
            {queue.map(d => <button key={d.id} type="button" className={'auto-queue-item ' + (current?.id === d.id ? 'chosen' : '')} onClick={() => choose(d)}>
              <strong>{d.job.role}</strong><small>{d.job.company}</small><span>{d.status} · {readableDate(d.preparedAt)}</span>
            </button>)}
          </div>
          {current && <div className="auto-detail">
            <h3>{current.job.role}</h3>
            <p>{current.job.company} · {current.job.location}</p>
            <div className="auto-skill-summary">
              {(() => { const a = assessForAutopilot(current.job, getCv().verifiedFacts, applications); return a.direct.length + ' CV matches · ' + a.transferable.length + ' related · ' + a.missing.length + ' missing'; })()}
            </div>
            <div className="auto-channel">
              <strong>طريقة التقديم</strong>
              <span>{currentChannel?.kind === 'email_candidate' ? 'إيميل مذكور في الإعلان — يحتاج تأكيدًا من الشركة' : 'التقديم عبر الموقع فقط — لا يوجد بريد تقديم مؤكد'}</span>
              {currentChannel?.kind === 'email_candidate' && <span className="auto-email">{currentChannel.email}</span>}
              <a href={current.job.sourceUrl} target="_blank" rel="noopener noreferrer">افتح المصدر للتحقق ↗</a>
            </div>
            <button type="button" className="auto-cv-btn" onClick={previewCv}>تحميل CV مخصص بنفس تصميم الملف الأصلي PDF</button>
            <label className="auto-field">Prepared application — editable
              <textarea rows={9} value={current.body} onChange={e => modifyBody(e.target.value)} />
            </label>
            <details className="auto-extra"><summary>Verified direct recruiter email (optional)</summary>
              <label className="auto-field">البريد الموثّق من صاحب العمل (اختياري)
                <input type="email" value={email || (currentChannel?.kind === 'email_candidate' ? currentChannel.email : '')}
                  onChange={e => { setEmail(e.target.value); setEmailChecked(false); }}
                  placeholder="بريد التقديم بعد التحقق" /></label>
              <label className="auto-verify"><input type="checkbox" checked={emailChecked} onChange={e => setEmailChecked(e.target.checked)} />
                تحققت بنفسي من هذا البريد في مصدر رسمي تابع للشركة. عند تركه دون تحديد، سيُفتح موقع الوظيفة بدل الإيميل.
              </label>
            </details>
            <div className="auto-actions">
              <button type="button" className="auto-approve" onClick={approveHandoff}>✓ Approve & open application</button>
              <button type="button" className="auto-trash" onClick={trash}>Trash</button>
            </div>
            {current.status === 'Handoff' && <button type="button" className="auto-confirm" onClick={markSubmitted}>I completed the submission</button>}
            <p className="auto-fine">Approve opens the employer portal or a mail draft, not a sent email. Confirm submission only after completing it.</p>
          </div>}
        </div>
      )}
      {lastSource && <p className="auto-fine">Latest source: {lastSource}. A job link does not guarantee eligibility or an active vacancy.</p>}
    </section>
  );
}
