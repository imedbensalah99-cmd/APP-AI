import { useEffect, useState } from 'react';
import { prepareAutopilot, assessForAutopilot, type JobDecision } from './autopilot';
import { searchJobFeeds, uniqueLeads, type DiscoveredJob, type ReviewDraft } from './discovery';
import { generateCvHtml, makeInitialCv, type TailoredCv, type CvSourceProfile } from './cvMaker';
import type { JobApplication } from './types';
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
    headline: base?.headline || 'AML Analyst',
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
  const current = queue.find(d => d.id === active) || queue.find(d => d.status !== 'Sent-confirmed') || queue[0];
  const unsent = queue.filter(d => d.status !== 'Sent-confirmed');
  const sent = queue.filter(d => d.status === 'Sent-confirmed');

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

  function choose(draft: ReviewDraft) {
    setActive(draft.id);
    setEmail(draft.recipient || '');
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
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !emailChecked)) {
      setNote('Verify the recruiter email against the employer website before using it.');
      return;
    }
    const approved = window.confirm('Open the external ' + (email ? 'email draft' : 'job application page') +
      ' for ' + current.job.company + '? You still must verify eligibility, attach the actual PDF CV, and submit yourself. Nothing is sent by APP-AI.');
    if (!approved) return;
    if (email) {
      const lines = current.body.split('\n');
      const hasSubject = lines[0]?.startsWith('Subject: ');
      const subject = hasSubject ? lines[0].slice(9) : 'Application – ' + current.job.role;
      const body = hasSubject ? lines.slice(1).join('\n') : current.body;
      window.location.href = 'mailto:' + encodeURIComponent(email.trim()).replace(/%40/g, '@') +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    } else window.open(current.job.sourceUrl, '_blank', 'noopener,noreferrer');
    setQueue(old => old.map(d => d.id === current.id ? { ...d, status: 'Handoff' } : d));
    setNote('Opened the employer/application channel. APP-AI did not send an email or apply automatically.');
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
    const cv = currentCv(current.job);
    const page = window.open('', '_blank');
    if (!page) { setNote('Please enable popup windows to preview the CV.'); return; }
    page.document.open();
    page.document.write(generateCvHtml(cv, current.job));
    page.document.close();
    setNote('Tailored CV opened. Use Print / Save as PDF and verify every line before submitting.');
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
              <span>{d.explanation}</span><a target="_blank" rel="noopener noreferrer" href={d.job.sourceUrl}>Original vacancy ↗</a></div>
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
            <button type="button" className="auto-cv-btn" onClick={previewCv}>↗ View tailored CV / Save as PDF</button>
            <label className="auto-field">Prepared application — editable
              <textarea rows={9} value={current.body} onChange={e => modifyBody(e.target.value)} />
            </label>
            <details className="auto-extra"><summary>Verified direct recruiter email (optional)</summary>
              <label className="auto-field">Recipient
                <input type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailChecked(false); }} placeholder="Only if published by the employer" /></label>
              {email && <label className="auto-verify"><input type="checkbox" checked={emailChecked} onChange={e => setEmailChecked(e.target.checked)} /> I checked the exact address on the employer website.</label>}
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
