import { useEffect, useMemo, useState } from 'react';
import { generateDraft, isValidRecruiterEmail } from './agent';
import { parseImportedJobs, rankLead, searchJobFeeds, uniqueLeads, type DiscoveredJob, type ReviewDraft } from './discovery';
import type { JobApplication } from './types';
import { validWebUrl } from './data';
import './workflow.css';

const JOBS_KEY = 'app-ai:discovered:v2';
const DRAFTS_KEY = 'app-ai:review-drafts:v2';
const LAST_KEY = 'app-ai:discovered-date:v2';
const PROFILE_KEY = 'app-ai:agent-profile:v1';
const NAME_KEY = 'app-ai:agent-profile-name:v1';

function loadStored<T>(key: string, fallback: T, validator: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validator(parsed) ? parsed : fallback;
  } catch { return fallback; }
}
const isJob = (j: unknown): j is DiscoveredJob =>
  !!j && typeof j === 'object' && typeof (j as DiscoveredJob).id === 'string' &&
  typeof (j as DiscoveredJob).role === 'string' && typeof (j as DiscoveredJob).sourceUrl === 'string' && !!(j as DiscoveredJob).company && !!validWebUrl((j as DiscoveredJob).sourceUrl);
const isDraft = (j: unknown): j is ReviewDraft =>
  !!j && typeof j === 'object' && typeof (j as ReviewDraft).id === 'string' &&
  typeof (j as ReviewDraft).body === 'string' && isJob((j as ReviewDraft).job);
const jobList = (value: unknown): value is DiscoveredJob[] => Array.isArray(value) && value.length <= 300 && value.every(isJob);
const draftList = (value: unknown): value is ReviewDraft[] => Array.isArray(value) && value.length <= 300 && value.every(isDraft);
const cleanHtmlText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 12000);

interface Props {
  applications: JobApplication[];
  onConfirmedSend: (job: DiscoveredJob) => void;
}
type Panel = 'jobs' | 'drafts';

export default function WorkflowBoard({ applications, onConfirmedSend }: Props) {
  const [jobs, setJobs] = useState<DiscoveredJob[]>(() => loadStored(JOBS_KEY, [], jobList));
  const [drafts, setDrafts] = useState<ReviewDraft[]>(() => loadStored(DRAFTS_KEY, [], draftList));
  const [lastSearch, setLastSearch] = useState(() => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } });
  const [panel, setPanel] = useState<Panel>('jobs');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeDraft, setActiveDraft] = useState<string>('');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('compliance');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [approved, setApproved] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [allowApplication, setAllowApplication] = useState(false);

  useEffect(() => { try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); } catch { setStatus('Browser storage unavailable; discovered jobs may not persist.'); } }, [jobs]);
  useEffect(() => { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { setStatus('Browser storage unavailable; export drafts manually.'); } }, [drafts]);

  useEffect(() => {
    if (!location.hash.startsWith('#jobs=')) return;
    const fragment = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const imported = parseImportedJobs(decodeURIComponent(fragment.slice(6)));
      setJobs(current => uniqueLeads([...imported, ...current]));
      setStatus('Imported ' + imported.length + ' researched leads. Verify each vacancy before applying.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import leads.');
    }
  }, []);

  const profile = () => ({
    facts: (() => { try { return localStorage.getItem(PROFILE_KEY) || ''; } catch { return ''; } })(),
    name: (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } })(),
  });

  const current = drafts.find(item => item.id === activeDraft) ?? drafts[0];
  const sorted = useMemo(() => {
    const facts = profile().facts;
    return jobs.map(job => ({ job, rank: rankLead(job, facts, applications) }))
      .filter(item => !applications.some(a => a.sourceUrl && a.sourceUrl === item.job.sourceUrl))
      .sort((a, b) => b.rank.score - a.rank.score || b.job.published.localeCompare(a.job.published));
  }, [jobs, applications]);

  const pending = drafts.filter(d => d.status !== 'Sent-confirmed');
  const sent = drafts.filter(d => d.status === 'Sent-confirmed');

  async function searchNow() {
    if (searching) return;
    setSearching(true);
    setStatus('Checking live public job feeds for Qatar-eligible roles…');
    const terms = Array.from(new Set([keyword.trim() || 'compliance', 'operations', 'finance', 'customer support']));
    const results = await Promise.allSettled(terms.map(term => searchJobFeeds(fetch, term)));
    const found = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const failures = results.filter(r => r.status === 'rejected').length;
    let source = 'live public API';
    let listings = found;
    if (failures === results.length) {
      try {
        const response = await fetch(import.meta.env.BASE_URL + 'jobs-cache.json?refresh=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('No cached data available');
        const cached: unknown = await response.json();
        if (!cached || typeof cached !== 'object') throw new Error('Invalid cache');
        const value = cached as { jobs?: unknown };
        if (!jobList(value.jobs)) throw new Error('Invalid cache');
        listings = value.jobs;
        source = 'last scheduled snapshot (not live)';
      } catch {
        setStatus('Live source could not be reached from this browser. Try again; no jobs were invented or submitted.');
        setSearching(false);
        return;
      }
    }
    const next = uniqueLeads([...listings, ...jobs], applications);
    setJobs(next);
    setSelected([]);
    const now = new Date().toISOString();
    setLastSearch(now);
    try { localStorage.setItem(LAST_KEY, now); } catch { /* Nonpersistent browser. */ }
    setStatus('Found ' + listings.length + ' source listings from ' + source + '; ' +
      next.length + ' unique leads in your browser. ' +
      (failures ? failures + ' source queries were unavailable. ' : '') +
      'Employer requirements and availability still need checking.');
    setSearching(false);
    setPanel('jobs');
  }

  function addImported() {
    try {
      const added = parseImportedJobs(importText);
      setJobs(old => uniqueLeads([...added, ...old], applications));
      setImportText('');
      setShowImport(false);
      setStatus('Imported ' + added.length + ' leads to the job list; employer verification is still required.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed.');
    }
  }

  function generateSelected() {
    const { name, facts } = profile();
    if (!name.trim() || !facts.trim()) { setStatus('Fill your verified CV name and facts in the profile panel below first.'); return; }
    const chosen = jobs.filter(j => selected.includes(j.id));
    if (!chosen.length) { setStatus('Select at least one job first.'); return; }
    const now = new Date().toISOString();
    const existing = new Set(drafts.map(d => d.job.sourceUrl));
    const created: ReviewDraft[] = chosen.filter(j => !existing.has(j.sourceUrl)).map(job => ({
      id: job.id, job, recipient: '', body: generateDraft(job, facts, name),
      status: 'Draft', preparedAt: now,
    }));
    setDrafts(old => [...created, ...old]);
    setSelected([]);
    setPanel('drafts');
    if (created[0]) setActiveDraft(created[0].id);
    setApproved(false); setEmailVerified(false); setAllowApplication(false);
    setStatus('Prepared ' + created.length + ' factual draft(s) for review; none has been sent.');
  }

  function editDraft(change: Partial<ReviewDraft>) {
    if (!current) return;
    setDrafts(items => items.map(d => d.id === current.id ? { ...d, ...change } : d));
    setApproved(false);
    setEmailVerified(false);
    setAllowApplication(false);
  }

  function chooseDraft(id: string) {
    setActiveDraft(id);
    setApproved(false); setEmailVerified(false); setAllowApplication(false);
  }

  function trashDraft() {
    if (!current || !window.confirm('Trash this application draft? This will NOT send anything.')) return;
    setDrafts(items => items.filter(d => d.id !== current.id));
    setActiveDraft('');
    setApproved(false); setEmailVerified(false); setAllowApplication(false);
    setStatus('Draft discarded without sending.');
  }

  function approveHandoff() {
    if (!current || !approved) return;
    if (!allowApplication) { setStatus('Confirm you checked the current employer vacancy and nationality requirements.'); return; }
    if (current.recipient.trim()) {
      if (!isValidRecruiterEmail(current.recipient) || !emailVerified) { setStatus('Verify the exact recruitment email from an official source before proceeding.'); return; }
      const lines = current.body.split('\n');
      const subject = lines[0].startsWith('Subject: ') ? lines[0].slice(9) : 'Application – ' + current.job.role;
      const body = lines[0].startsWith('Subject: ') ? lines.slice(1).join('\n') : current.body;
      // mailto: only opens a draft. It never sends or attaches a file.
      window.location.href = 'mailto:' + current.recipient.trim() + '?subject=' +
        encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    } else {
      window.open(current.job.sourceUrl, '_blank', 'noopener,noreferrer');
    }
    setDrafts(items => items.map(d => d.id === current.id ? { ...d, status: 'Handoff' } : d));
    setApproved(false); setEmailVerified(false); setAllowApplication(false);
    setStatus('Opened external application channel. NOT sent by APP-AI. Attach your CV and submit there, then return to confirm.');
  }

  function markSent() {
    if (!current || current.status !== 'Handoff') return;
    if (!window.confirm('Confirm only if you personally submitted the application or sent the email with your CV. APP-AI cannot verify it automatically.')) return;
    setDrafts(items => items.map(d => d.id === current.id ? { ...d, status: 'Sent-confirmed' } : d));
    onConfirmedSend(current.job);
    setStatus('Marked sent based on your confirmation (not externally verified). Added to the tracker.');
  }

  function downloadDraft() {
    if (!current) return;
    const blob = new Blob([current.body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'application-draft.txt'; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section id="discover" className="workflow" aria-label="One-button job application workflow">
      <div className="workflow-top">
        <div><span className="eyebrow">THEME 1 · MODERN BLUE</span><h2>Find jobs. Review drafts. Stay in control.</h2>
        <p>Searches free live remote-job feeds for applicants in Qatar. No fake postings, no paid services and no automatic sending.</p></div>
        <div className="workflow-clock">{lastSearch ? 'Last search: ' + new Date(lastSearch).toLocaleString() : 'No search yet'}</div>
      </div>
      <div className="workflow-search">
        <label className="workflow-search-field">Focus
          <select value={keyword} onChange={e => setKeyword(e.target.value)}>
            <option value="compliance">AML / Compliance</option>
            <option value="operations">Banking / Operations</option>
            <option value="finance">Finance / Accounting</option>
            <option value="customer support">Customer Service</option>
            <option value="data">Data / Administration</option>
          </select>
        </label>
        <button type="button" className="workflow-search-button" disabled={searching} onClick={searchNow}>
          {searching ? 'Searching online…' : '⌕ Search Jobs Now'}
        </button>
      </div>
      {status && <p className="workflow-message" role="status">{status}</p>}
      <div className="workflow-tabs" role="tablist" aria-label="Job application phases">
        <button type="button" role="tab" aria-selected={panel === 'jobs'} className={panel === 'jobs' ? 'is-on' : ''} onClick={() => setPanel('jobs')}>New Jobs ({sorted.length})</button>
        <button type="button" role="tab" aria-selected={panel === 'drafts'} className={panel === 'drafts' ? 'is-on' : ''} onClick={() => setPanel('drafts')}>Drafts ({pending.length})</button>
        <span>Confirmed: {sent.length}</span>
      </div>
      {panel === 'jobs' ? (
        <div className="workflow-grid">
          <div className="workflow-list">
            <div className="workflow-list-toolbar">
              <strong>New job opportunities</strong>
              <button className="workflow-link" onClick={() => setShowImport(v => !v)} type="button">
                {showImport ? 'Close import' : '+ Import ChatGPT leads'}
              </button>
            </div>
            {showImport && <div className="workflow-import">
              <p>Paste a JSON array of researched jobs: company, role, sourceUrl, location, description. Jobs will appear in the same list but still require source verification.</p>
              <textarea rows={5} value={importText} onChange={e => setImportText(e.target.value)} placeholder={'[{"company":"Example","role":"Compliance Analyst","sourceUrl":"https://employer.example/careers","location":"Doha","description":"Requirements..."}]'} />
              <button type="button" className="workflow-secondary" onClick={addImported}>Import job leads</button>
            </div>}
            <div className="workflow-list-toolbar">
              <label className="workflow-select-all"><input type="checkbox" checked={sorted.length > 0 && selected.length === sorted.length} onChange={e => setSelected(e.target.checked ? sorted.map(i => i.job.id) : [])} /> Select all visible</label>
              <span>{selected.length} selected</span>
            </div>
            {!sorted.length && <div className="workflow-empty">No eligible job leads loaded. Press <strong>Search Jobs Now</strong>. Qatar-local jobs from employer websites can also be imported from verified ChatGPT research.</div>}
            {sorted.map(({ job, rank }) => <article className="workflow-job" key={job.id}>
              <input type="checkbox" aria-label={'Select ' + job.role + ' at ' + job.company} checked={selected.includes(job.id)} onChange={e => setSelected(old => e.target.checked ? [...old, job.id] : old.filter(id => id !== job.id))}/>
              <div className="workflow-job-info"><strong>{job.role}</strong><span>{job.company} · {job.location}</span>
                <small>{job.source} {job.published && '· ' + job.published}</small>
                <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">View original listing ↗</a>
                {rank.concerns.length > 0 && <small className="workflow-warn">{rank.concerns[0]}</small>}
              </div>
              <span className="workflow-match">{rank.scoreLabel}</span>
            </article>)}
            <button type="button" className="workflow-search-button workflow-generate" onClick={generateSelected} disabled={!selected.length}>Prepare {selected.length || ''} application draft{selected.length === 1 ? '' : 's'} →</button>
          </div>
          <aside className="workflow-aside"><h3>Simple application process</h3><p>1. Search live jobs</p><p>2. Select suitable roles</p><p>3. Generate CV-based drafts</p><p>4. Approve opening the employer or email app</p><p>5. Mark sent only after you complete submission</p>
            <div className="workflow-warning">Job matches are based on CV keywords, not confirmed eligibility. New jobs are not proof of an open vacancy until you check the employer page.</div>
            <a href="#agent-heading">Edit private CV profile ↓</a>
          </aside>
        </div>
      ) : (
        <div className="workflow-grid">
          <div className="workflow-list">
            <div className="workflow-list-toolbar"><strong>Application review queue</strong><span>{pending.length} awaiting review</span></div>
            {!drafts.length && <div className="workflow-empty">No drafts yet. Select jobs and press “Prepare application drafts”.</div>}
            {drafts.map(d => <button type="button" key={d.id} onClick={() => chooseDraft(d.id)} className={'workflow-draft-choice ' + (current?.id === d.id ? 'active' : '')}>
              <span><strong>{d.job.role}</strong><small>{d.job.company}</small></span><em>{d.status}</em>
            </button>)}
          </div>
          {current && <aside className="workflow-review">
            <h3>Application Draft</h3>
            <p>{current.job.role} · {current.job.company}</p>
            <a href={current.job.sourceUrl} target="_blank" rel="noopener noreferrer">Verify current employer application ↗</a>
            <label>Recruiter email (optional; enter only if verified by the employer)
              <input type="email" value={current.recipient} onChange={e => editDraft({recipient: e.target.value})} placeholder="Verified recruitment email" />
            </label>
            <label>Email / cover letter — edit before sending
              <textarea rows={13} value={current.body} onChange={e => editDraft({body: cleanHtmlText(e.target.value)})} />
            </label>
            <div className="workflow-checks">
              <label><input type="checkbox" checked={allowApplication} onChange={e => setAllowApplication(e.target.checked)} /> I checked the employer posting is open and I meet its requirements.</label>
              {current.recipient && <label><input type="checkbox" checked={emailVerified} onChange={e => setEmailVerified(e.target.checked)} /> I verified this recipient from the employer's official website.</label>}
              <label><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /> I approve opening the external application channel to review and send myself.</label>
            </div>
            <div className="workflow-review-buttons">
              <button type="button" className="workflow-approve" disabled={!approved || !allowApplication || (!!current.recipient && (!isValidRecruiterEmail(current.recipient) || !emailVerified))} onClick={approveHandoff}>✓ Approve & open {current.recipient ? 'email draft' : 'job application'}</button>
              <button type="button" className="workflow-danger" onClick={trashDraft}>Trash draft</button>
              <button type="button" className="workflow-secondary" onClick={downloadDraft}>Download draft</button>
              {current.status === 'Handoff' && <button type="button" className="workflow-secondary" onClick={markSent}>I sent / submitted this application</button>}
            </div>
            <div className="workflow-warning">Approval opens your email app or employer website. It does NOT send the application, attach your PDF CV, accept terms, or prove submission. Confirm sent only afterward.</div>
          </aside>}
        </div>
      )}
    </section>
  );
}
