import { useEffect, useMemo, useState } from 'react';
import { isValidRecruiterEmail, parseCvProfileFragment } from './agent';
import { EMPTY_FIELDS, type ApplicationFields, type JobApplication } from './types';
import { todayLocal } from './data';
import {
  jobAssessment, loadDrafts, makeDraft, normalizeFeed,
  type ApplicationDraft, type DiscoveredJob, type JobFeed, type DraftState,
} from './discovery';
import './jobs-workspace.css';

const PROFILE_KEY = 'app-ai:agent-profile:v1';
const NAME_KEY = 'app-ai:agent-profile-name:v1';
const DRAFT_KEY = 'app-ai:review-queue:v1';
const CACHE_KEY = 'app-ai:public-feed:v1';
type Page = 'jobs' | 'drafts' | 'sent' | 'profile';
type Area = 'all' | 'remote' | 'qatar-lead';
type Checks = { posting: boolean; eligibility: boolean; recipient: boolean };
const DEFAULT_CHECKS: Checks = { posting: false, eligibility: false, recipient: false };

interface Props {
  applications: JobApplication[];
  onAddApplication: (fields: ApplicationFields) => void;
}

function storageValue(key: string) {
  try { return window.localStorage.getItem(key) || ''; }
  catch { return ''; }
}
function storedDrafts(): ApplicationDraft[] {
  try { return loadDrafts(window.localStorage, DRAFT_KEY); }
  catch { return []; }
}
function parseSavedFeed(): JobFeed | null {
  try { const saved = storageValue(CACHE_KEY); return saved ? normalizeFeed(JSON.parse(saved)) : null; }
  catch { return null; }
}
function formatTime(value: string) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Unknown';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function hasExpired(feed: JobFeed) {
  return Date.now() - new Date(feed.generatedAt).getTime() > 12 * 60 * 60 * 1000;
}
function selectedToJob(job: DiscoveredJob) {
  return { company: job.company, role: job.role, sourceUrl: job.sourceUrl,
    description: job.description, location: job.location };
}

export default function JobsWorkspace({ applications, onAddApplication }: Props) {
  const [page, setPage] = useState<Page>('jobs');
  const [feed, setFeed] = useState<JobFeed | null>(parseSavedFeed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [area, setArea] = useState<Area>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<ApplicationDraft[]>(storedDrafts);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Checks>>({});
  const [name, setName] = useState(() => storageValue(NAME_KEY));
  const [facts, setFacts] = useState(() => storageValue(PROFILE_KEY));
  const [showTrash, setShowTrash] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#cv=')) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const imported = parseCvProfileFragment(hash);
    if (imported) {
      setName(imported.fullName);
      setFacts(imported.facts);
      setNotice('Professional CV information imported locally. Review it under My CV.');
    } else setNotice('The CV prefill link was invalid; no details were imported.');
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(NAME_KEY, name); window.localStorage.setItem(PROFILE_KEY, facts); }
    catch { setNotice('Browser storage is unavailable: CV profile may not persist.'); }
  }, [name, facts]);
  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); }
    catch { setNotice('Cannot save drafts locally. Free up storage or export your notes.'); }
  }, [drafts]);

  const jobs = useMemo(() => feed?.jobs.filter(job => {
    const term = search.toLocaleLowerCase().trim();
    return (area === 'all' || job.kind === area) &&
      (!term || [job.company, job.role, job.location, job.description].some(s =>
        s.toLocaleLowerCase().includes(term)));
  }) ?? [], [feed, search, area]);
  const queue = drafts.filter(d => d.state !== 'trashed' && d.state !== 'reported-sent');
  const sent = drafts.filter(d => d.state === 'reported-sent');
  const ready = queue.filter(d => d.state === 'ready');
  const trash = drafts.filter(d => d.state === 'trashed');
  const active = queue.find(d => d.id === activeId) || queue[0] || null;

  async function searchJobs() {
    setPage('jobs');
    setLoading(true); setError(''); setNotice('');
    try {
      const url = import.meta.env.BASE_URL + 'jobs.json?refresh=' + Date.now();
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const fetched = normalizeFeed(await response.json());
      setFeed(fetched);
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(fetched)); } catch { /* not essential */ }
      setSelected([]);
      setNotice(fetched.jobs.length
        ? 'Loaded ' + fetched.jobs.length + ' source records. Confirm each vacancy is active and eligible before applying.'
        : 'The current free feeds contain no matching listings. No sample or invented jobs were added.');
    } catch (e) {
      setError('Could not refresh the published job feed (' + String(e) + '). ' +
        (feed ? 'Showing the previously cached feed.' : 'Try again later.'));
    } finally { setLoading(false); }
  }
  function toggle(id: string) {
    setSelected(s => s.includes(id) ? s.filter(k => k !== id) : [...s, id]);
  }
  function makeDrafts() {
    if (!name.trim() || !facts.trim()) {
      setPage('profile'); setNotice('First review and save your factual CV profile.'); return;
    }
    const newJobs = (feed?.jobs || []).filter(j => selected.includes(j.id));
    if (!newJobs.length) { setNotice('Select one or more jobs first.'); return; }
    const existingIds = new Set(drafts.map(d => d.id));
    const next = newJobs.filter(j => !existingIds.has(j.id)).map(j => makeDraft(j, facts, name));
    if (next.length) setDrafts(d => [...next, ...d]);
    setSelected([]); setPage('drafts');
    setActiveId(newJobs[0]?.id || null);
    setNotice(next.length + ' new draft(s) prepared locally. Review and edit before email handoff.');
  }
  function updateDraft(id: string, value: Partial<ApplicationDraft>) {
    setDrafts(previous => previous.map(d => d.id === id ? { ...d, ...value, updatedAt: new Date().toISOString() } : d));
  }
  function disposition(id: string, state: DraftState) {
    updateDraft(id, { state });
    if (state === 'trashed' && activeId === id) setActiveId(null);
    setNotice(state === 'trashed' ? 'Draft moved to Trash, not sent.' : 'Draft restored for review.');
  }
  function toggleCheck(id: string, key: keyof Checks, checked: boolean) {
    setChecks(x => ({ ...x, [id]: { ...(x[id] || DEFAULT_CHECKS), [key]: checked } }));
  }
  function openMail(draft: ApplicationDraft) {
    const confirmed = checks[draft.id] || DEFAULT_CHECKS;
    if (!confirmed.posting || !confirmed.eligibility || !confirmed.recipient) {
      setNotice('Confirm the vacancy, eligibility and recipient before handoff.'); return;
    }
    if (!isValidRecruiterEmail(draft.email)) { setNotice('Enter an officially verified recruitment email address.'); return; }
    const [headline, , ...message] = draft.body.split('\n');
    const subject = headline.startsWith('Subject:') ? headline.replace(/^Subject:\s*/, '') : 'Job application — ' + draft.job.role;
    const url = 'mailto:' + encodeURIComponent(draft.email) + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(message.join('\n'));
    updateDraft(draft.id, { state: 'handoff' });
    setNotice('Opening your email app for your final Send action. Your CV is NOT attached automatically, and no email has been sent by APP-AI.');
    window.location.href = url;
  }
  function markSent(draft: ApplicationDraft) {
    if (!window.confirm('Did you actually send this application with your CV from your email app? APP-AI cannot independently verify delivery.')) return;
    const found = applications.some(a => a.sourceUrl === draft.job.sourceUrl ||
      (a.company.toLowerCase() === draft.job.company.toLowerCase() && a.role.toLowerCase() === draft.job.role.toLowerCase()));
    if (!found) onAddApplication({
      ...EMPTY_FIELDS,
      company: draft.job.company, role: draft.job.role, location: draft.job.location,
      sourceUrl: draft.job.sourceUrl, status: 'Applied', appliedOn: todayLocal(),
      notes: 'User reported manually sending the application via their email app. Delivery/attachment not independently verified. Source: ' + draft.job.source,
    });
    disposition(draft.id, 'reported-sent');
    setNotice('Marked as user-reported sent. This is not independent delivery confirmation.');
  }
  async function copyDraft(body: string) {
    try { await navigator.clipboard.writeText(body); setNotice('Draft copied.'); }
    catch { setNotice('Clipboard unavailable: select the draft text and copy manually.'); }
  }
  const nav: { id: Page; icon: string; title: string; count?: number }[] = [
    { id: 'jobs', icon: '⌕', title: 'Search Jobs', count: feed?.jobs.length || 0 },
    { id: 'drafts', icon: '✎', title: 'Drafts', count: queue.length },
    { id: 'sent', icon: '↗', title: 'Sent', count: sent.length },
    { id: 'profile', icon: '♙', title: 'My CV' },
  ];
  return (
    <section className="jobs-shell" aria-label="Modern Blue Job Application Workspace">
      <div className="jobs-topbar">
        <div className="jobs-logo"><span className="jobs-logo-mark">✦</span><span><strong>APP-AI</strong><small>JOB APPLICATION AGENT</small></span></div>
        <span className="jobs-location">🇶🇦 Qatar job search</span>
      </div>
      <div className="jobs-layout">
        <aside className="jobs-sidebar" aria-label="Application sections">
          <p>WORKSPACE</p>
          {nav.map(n => <button key={n.id} type="button" className={page === n.id ? 'current' : ''} onClick={() => { setPage(n.id); setNotice(''); }}>
            <span>{n.icon}</span>{n.title}{n.count !== undefined && <em>{n.count}</em>}
          </button>)}
          <small>Free public feed • Personal data stays in this browser</small>
        </aside>
        <div className="jobs-content">
          <div className="jobs-welcome">
            <span>YOUR CAREER COMMAND CENTER</span>
            <h2>{page === 'jobs' ? 'Find your next opportunity.' : page === 'drafts' ? 'Review application drafts.' : page === 'sent' ? 'Applications reported sent.' : 'Your private CV profile.'}</h2>
            <p>{page === 'jobs' ? 'One search. Select jobs. Review drafts. You choose what gets sent.' :
              page === 'drafts' ? 'Nothing is emailed until you review and send it yourself.' :
              page === 'sent' ? 'These records are marked sent by you, not verified by an email provider.' :
              'The following information is stored only on this device.'}</p>
            {page === 'jobs' && <button className="jobs-main-button" onClick={searchJobs} disabled={loading} type="button">
              {loading ? '⌛ Checking latest feed…' : '⌕ Search Jobs Now'} <span>↗</span>
            </button>}
          </div>
          {notice && <div className="jobs-notice" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
          {error && <p role="alert" className="jobs-error">{error}</p>}
          {page === 'jobs' && <>
            <div className="jobs-metrics">
              <div><small>Jobs from feeds</small><strong>{feed?.jobs.length ?? '—'}</strong><span>No examples added</span></div>
              <div><small>Selected</small><strong>{selected.length}</strong><span>For draft preparation</span></div>
              <div><small>Ready drafts</small><strong>{ready.length}</strong><span>Review before email</span></div>
            </div>
            <div className="jobs-section-title">
              <div><h3>Available opportunities</h3><p>{feed ? 'Last collected: ' + formatTime(feed.generatedAt) + (hasExpired(feed) ? ' · Older than 12 hours' : '') : 'Press Search Jobs Now to load the most recently collected listings.'}</p></div>
            </div>
            <div className="jobs-filter-row">
              <label className="jobs-search-input">⌕ <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, employer or skill" /></label>
              <select aria-label="Job location category" value={area} onChange={e => setArea(e.target.value as Area)}>
                <option value="all">All opportunities</option>
                <option value="remote">Remote — Qatar eligibility check</option>
                <option value="qatar-lead">Qatar leads — unverified</option>
              </select>
            </div>
            {feed?.errors.length ? <p className="jobs-source-warning">Some feeds were unavailable: {feed.errors.join('; ').slice(0, 400)}</p> : null}
            <p className="jobs-caution">Himalayas remote job-board listings are not independently employer-verified. Qatar news results are unverified leads, not confirmed vacancies. Check all application pages and nationality requirements. <a href="https://himalayas.app" target="_blank" rel="noopener noreferrer">Remote source: Himalayas ↗</a></p>
            <div className="jobs-result-list">
              {!feed && <div className="jobs-empty"><strong>Ready to search?</strong><p>Tap the blue button. Your publicly sourced jobs will appear here without copying and pasting.</p></div>}
              {feed && jobs.length === 0 && <div className="jobs-empty"><strong>No matching listings in this feed.</strong><p>Try another category or search again after the next scheduled feed refresh.</p></div>}
              {jobs.map(job => {
                const match = jobAssessment(job, facts, applications);
                const alreadyDrafted = drafts.some(d => d.id === job.id);
                return <article key={job.id} className={'jobs-result ' + (selected.includes(job.id) ? 'jobs-picked' : '')}>
                  <label className="jobs-select-job"><input aria-label={'Select ' + job.role + ' at ' + job.company} checked={selected.includes(job.id)} disabled={match.duplicate || alreadyDrafted} onChange={() => toggle(job.id)} /></label>
                  <span className="jobs-company-icon">{job.company.charAt(0).toUpperCase()}</span>
                  <div className="jobs-result-main">
                    <div className="jobs-title-row"><h4>{job.role}</h4><span className={job.kind === 'remote' ? 'jobs-tag-blue' : 'jobs-tag-amber'}>{job.kind === 'remote' ? 'Remote listing' : 'Unverified Qatar lead'}</span></div>
                    <p>{job.company} <span>·</span> {job.location}</p>
                    <small>{match.matching.length ? 'CV term overlap: ' + match.matching.slice(0, 4).join(', ') : 'No matching keywords detected'}</small>
                    {match.concerns.some(x => /Qatari|Senior|fee/.test(x)) && <small className="jobs-redflag">⚠ Additional eligibility checks required</small>}
                    <div className="jobs-result-links"><a href={job.sourceUrl} rel="noopener noreferrer" target="_blank">View source ↗</a>
                      <span>{job.source}</span>
                      {match.duplicate && <span>Already in tracker</span>}{alreadyDrafted && <span>Draft exists</span>}
                    </div>
                  </div>
                </article>;
              })}
            </div>
            {selected.length > 0 && <div className="jobs-selection-bar"><strong>{selected.length} selected</strong><button type="button" onClick={makeDrafts}>✎ Generate Drafts →</button></div>}
          </>}
          {page === 'drafts' && <>
            <div className="jobs-section-title"><div><h3>Draft review queue</h3><p>Edit every message, verify recruiter contact, and approve or trash.</p></div><button className="jobs-outline-button" type="button" onClick={() => setShowTrash(x => !x)}>Trash ({trash.length})</button></div>
            {showTrash && <div className="jobs-trash">{trash.map(d => <div key={d.id}><span>{d.job.role} · {d.job.company}</span><button onClick={() => disposition(d.id, 'ready')}>Restore</button></div>)}{trash.length === 0 && <p>Trash is empty.</p>}</div>}
            {queue.length === 0 ? <div className="jobs-empty"><strong>No drafts waiting.</strong><p>Search jobs, select opportunities, then generate drafts.</p><button onClick={() => setPage('jobs')} className="jobs-outline-button">Find jobs</button></div> :
              <div className="jobs-draft-grid">
                <div className="jobs-draft-list">{queue.map(d => <button type="button" className={active?.id === d.id ? 'active' : ''} key={d.id} onClick={() => setActiveId(d.id)}>
                  <strong>{d.job.role}</strong><span>{d.job.company}</span><small>{d.state === 'handoff' ? 'Email app opened — not confirmed sent' : 'Ready to review'}</small>
                </button>)}</div>
                {active && <div className="jobs-draft-editor">
                  <div className="jobs-draft-head"><h3>{active.job.role}</h3><a href={active.job.sourceUrl} target="_blank" rel="noopener noreferrer">Check original source ↗</a></div>
                  <p className="jobs-caution">{active.job.kind === 'qatar-lead' ? 'This is only an unverified Qatar news lead. Find the employer’s active vacancy before sending.' : 'Confirm the employer’s listing is still open and accepts applications from Qatar.'}</p>
                  <label>Recruitment email — from an official employer source only
                    <input type="email" value={active.email} onChange={e => { updateDraft(active.id, { email: e.target.value }); toggleCheck(active.id, 'recipient', false); }} placeholder="Leave blank until verified" />
                  </label>
                  <label>Editable email (subject on first line)
                    <textarea rows={15} value={active.body} onChange={e => updateDraft(active.id, { body: e.target.value })}/>
                  </label>
                  <div className="jobs-review-checks">
                    <label><input type="checkbox" checked={!!checks[active.id]?.posting} onChange={e => toggleCheck(active.id, 'posting', e.target.checked)} /> I checked the official vacancy is open</label>
                    <label><input type="checkbox" checked={!!checks[active.id]?.eligibility} onChange={e => toggleCheck(active.id, 'eligibility', e.target.checked)} /> I checked I meet the nationality and role requirements</label>
                    <label><input type="checkbox" checked={!!checks[active.id]?.recipient} onChange={e => toggleCheck(active.id, 'recipient', e.target.checked)} /> I verified this recruiter email on an official source</label>
                  </div>
                  <div className="jobs-draft-actions">
                    <button className="jobs-primary" type="button" onClick={() => openMail(active)}>✓ Approve &amp; Open Email</button>
                    <button className="jobs-outline-button" type="button" onClick={() => copyDraft(active.body)}>Copy</button>
                    <button className="jobs-trash-button" type="button" onClick={() => disposition(active.id, 'trashed')}>Trash</button>
                  </div>
                  <div className="jobs-handoff">
                    <strong>Sending happens in your email app, not here.</strong>
                    <p>After approving, review the recipient, attach the actual PDF CV and tap Send yourself. For employer website forms, copy the draft and open the posting. Neither action auto-submits or verifies delivery.</p>
                    {active.state === 'handoff' && <button type="button" className="jobs-outline-button" onClick={() => markSent(active)}>I actually sent this with my CV</button>}
                  </div>
                </div>}
              </div>}
          </>}
          {page === 'sent' && <div className="jobs-result-list">
            {!sent.length && <div className="jobs-empty"><strong>No user-reported sent applications yet.</strong><p>After sending from your email app, confirm it on the draft card to track it here.</p></div>}
            {sent.map(d => <div key={d.id} className="jobs-sent-item"><div><strong>{d.job.role}</strong><p>{d.job.company} · {formatTime(d.updatedAt)}</p><small>User-reported; not independently verified by email provider</small></div><button className="jobs-outline-button" type="button" onClick={() => disposition(d.id, 'ready')}>Return to drafts</button></div>)}
          </div>}
          {page === 'profile' && <div className="jobs-profile">
            <p>These fields are stored only in this browser. Your CV is not committed to the public repository, uploaded or shared with job sites.</p>
            <label>Full name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Your CV name"/></label>
            <label>CV-supported professional facts<textarea rows={10} value={facts} onChange={e => setFacts(e.target.value.slice(0, 5000))} placeholder="Paste factual roles, education, skills and languages here (no QID or passwords)."/></label>
            <div className="jobs-draft-actions">
              <button className="jobs-primary" type="button" onClick={() => { setPage('jobs'); setNotice('Profile saved in this browser. Search jobs and choose opportunities.'); }}>Save &amp; Search Jobs</button>
              <button className="jobs-trash-button" type="button" onClick={() => { if (window.confirm('Clear your locally stored name and CV facts?')) { setName(''); setFacts(''); } }}>Clear profile</button>
            </div>
          </div>}
        </div>
      </div>
      <nav className="jobs-mobile-nav" aria-label="Mobile workspace sections">
        {nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} type="button" onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.title}</button>)}
      </nav>
    </section>
  );
}
