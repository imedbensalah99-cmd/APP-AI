import { useMemo, useRef, useState, useEffect, type FormEvent } from 'react';
import { cleanFields, createApplication, isActive, needsAttention, readApplications, saveApplications, todayLocal, validWebUrl } from './data';
import { exportCsv, importCsv } from './csv';
import { EMPTY_FIELDS, STATUSES, type ApplicationFields, type ApplicationStatus, type JobApplication } from './types';
import AgentPanel from './AgentPanel';
import WorkflowBoard from './WorkflowBoard';
import type { DiscoveredJob } from './discovery';

type SortBy = 'updated' | 'company' | 'deadline' | 'followUp';
type FilterStatus = 'All' | ApplicationStatus;

function dateLabel(value: string): string {
  if (!value) return 'Not set';
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function statusStyle(status: ApplicationStatus): string {
  return 'status status-' + status.toLowerCase();
}

function compareOptionalDates(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

export default function App() {
  const [applications, setApplications] = useState<JobApplication[]>(() => {
    try { return readApplications(window.localStorage); }
    catch { return []; }
  });
  const [storageError, setStorageError] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('All');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<ApplicationFields>({ ...EMPTY_FIELDS });
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const today = todayLocal();

  useEffect(() => {
    try { setStorageError(!saveApplications(window.localStorage, applications)); }
    catch { setStorageError(true); }
  }, [applications]);

  const counts = useMemo(() => ({
    total: applications.length,
    active: applications.filter(job => isActive(job.status)).length,
    interviews: applications.filter(job => job.status === 'Interview').length,
    attention: applications.filter(job => needsAttention(job, today)).length,
  }), [applications, today]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return applications
      .filter(job => selectedStatus === 'All' || job.status === selectedStatus)
      .filter(job => !attentionOnly || needsAttention(job, today))
      .filter(job => !term || [job.company, job.role, job.location, job.notes].some(value =>
        value.toLocaleLowerCase().includes(term)))
      .sort((a, b) => {
        if (sortBy === 'company') return a.company.localeCompare(b.company);
        if (sortBy === 'deadline') return compareOptionalDates(a.deadline, b.deadline);
        if (sortBy === 'followUp') return compareOptionalDates(a.followUpOn, b.followUpOn);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [applications, query, selectedStatus, attentionOnly, sortBy, today]);

  const openNew = () => {
    setFields({ ...EMPTY_FIELDS });
    setEditingId(null);
    setFormError('');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (job: JobApplication) => {
    setFields({
      company: job.company, role: job.role, status: job.status,
      location: job.location, sourceUrl: job.sourceUrl,
      appliedOn: job.appliedOn, deadline: job.deadline,
      followUpOn: job.followUpOn, notes: job.notes,
    });
    setEditingId(job.id);
    setFormError('');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function updateField<Key extends keyof ApplicationFields>(key: Key, value: ApplicationFields[Key]) {
    setFields(previous => ({ ...previous, [key]: value }));
  }

  function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = cleanFields(fields);
    if (!clean) {
      setFormError('Company and job title are required.');
      return;
    }
    if (fields.sourceUrl.trim() && !validWebUrl(fields.sourceUrl.trim())) {
      setFormError('Enter a valid http:// or https:// job posting link.');
      return;
    }
    const now = new Date().toISOString();
    if (editingId) {
      setApplications(previous => previous.map(job =>
        job.id === editingId ? { ...job, ...clean, updatedAt: now } : job));
      setMessage('Application updated.');
    } else {
      setApplications(previous => [createApplication(clean, now), ...previous]);
      setMessage('Application added.');
    }
    setFormOpen(false);
    setEditingId(null);
  }

  function removeJob(job: JobApplication) {
    if (!window.confirm('Delete the application for ' + job.role + ' at ' + job.company + '?')) return;
    setApplications(previous => previous.filter(item => item.id !== job.id));
    setMessage('Application deleted.');
  }

  function downloadCsv() {
    const blob = new Blob([exportCsv(applications)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'job-applications-' + today + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('CSV backup downloaded. Store it securely.');
  }

  async function uploadCsv(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage('Import failed: CSV must be smaller than 2 MB.');
      if (importRef.current) importRef.current.value = '';
      return;
    }
    try {
      const content = await file.text();
      const result = importCsv(content, applications);
      if (result.added.length) setApplications(previous => [...result.added, ...previous]);
      setMessage('Imported ' + result.added.length + ' application(s). Skipped ' + result.skipped + ' invalid or duplicate row(s).');
    } catch (error) {
      setMessage('Import failed: ' + (error instanceof Error ? error.message : 'Unknown CSV error.'));
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#main" aria-label="APP-AI home">
            <span className="brand-mark">A</span>
            <span><strong>APP-AI</strong><small>JOB APPLICATION AGENT</small></span>
          </a>
          <nav className="app-topnav" aria-label="Main navigation"><a href="#discover">Search jobs</a><a href="#pipeline-title">Applications</a><a href="#agent-heading">CV profile</a></nav><span className="local-pill"><span aria-hidden="true">●</span> Device-local CV</span>
        </div>
      </header>

      <main id="main" className="container">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">YOUR CAREER WORKSPACE</span>
            <h1>Your next <em>opportunity</em> starts here.</h1>
            <p>Search Qatar-eligible openings in one tap, select roles, review tailored drafts and decide what to send.</p>
            <a className="primary-button" href="#discover">⌕ Search Jobs Now</a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orb orb-one"></div><div className="orb orb-two"></div>
            <div className="floating-card"><span>YOUR JOB AGENT</span><strong>Discover.<br />Review. Apply.</strong><i>↗</i></div>
          </div>
        </section>

        <div className="privacy-note">
          <span aria-hidden="true">🔒</span>
          <span>Your information stays in this browser. Export a CSV backup before clearing browser data or changing devices.</span>
        </div>
        {storageError && <p className="error-banner" role="alert">Browser storage is unavailable or full. Your changes may not be saved. Export a CSV backup now.</p>}
        {message && <div className="notice" role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="Dismiss notice">×</button></div>}

        <section className="stats-grid" aria-label="Application overview">
          <article className="stat-card"><span>Total applications</span><strong>{counts.total}</strong><small>All opportunities</small></article>
          <article className="stat-card"><span>Active pipeline</span><strong>{counts.active}</strong><small>Open opportunities</small></article>
          <article className="stat-card"><span>Interviews</span><strong>{counts.interviews}</strong><small>In progress</small></article>
          <article className="stat-card attention-card"><span>Needs attention</span><strong>{counts.attention}</strong><small>Due or overdue</small></article>
        </section>

        {formOpen && (
          <section className="form-panel" aria-labelledby="form-title">
            <div className="section-heading">
              <div><span className="eyebrow">APPLICATION DETAILS</span><h2 id="form-title">{editingId ? 'Edit application' : 'Add an opportunity'}</h2></div>
              <button className="subtle-button" type="button" onClick={() => setFormOpen(false)}>Close ×</button>
            </div>
            <form onSubmit={saveForm}>
              <div className="form-grid">
                <label>Company <span className="required">*</span>
                  <input required maxLength={120} value={fields.company} onChange={e => updateField('company', e.target.value)} placeholder="e.g. Example Bank" />
                </label>
                <label>Job title <span className="required">*</span>
                  <input required maxLength={120} value={fields.role} onChange={e => updateField('role', e.target.value)} placeholder="e.g. Operations Assistant" />
                </label>
                <label>Status
                  <select value={fields.status} onChange={e => updateField('status', e.target.value as ApplicationStatus)}>
                    {STATUSES.map(status => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label>Location
                  <input maxLength={160} value={fields.location} onChange={e => updateField('location', e.target.value)} placeholder="e.g. Doha, Qatar" />
                </label>
                <label>Applied on
                  <input type="date" value={fields.appliedOn} onChange={e => updateField('appliedOn', e.target.value)} />
                </label>
                <label>Application deadline
                  <input type="date" value={fields.deadline} onChange={e => updateField('deadline', e.target.value)} />
                </label>
                <label>Follow-up date
                  <input type="date" value={fields.followUpOn} onChange={e => updateField('followUpOn', e.target.value)} />
                </label>
                <label>Job posting URL
                  <input type="url" maxLength={2048} value={fields.sourceUrl} onChange={e => updateField('sourceUrl', e.target.value)} placeholder="https://..." />
                </label>
                <label className="span-two">Notes
                  <textarea rows={3} maxLength={4000} value={fields.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Next steps, contacts, interview preparation..." />
                </label>
              </div>
              {formError && <p className="validation-error" role="alert">{formError}</p>}
              <div className="form-actions">
                <button type="button" className="subtle-button" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add application'}</button>
              </div>
            </form>
          </section>
        )}

        <WorkflowBoard applications={applications} onConfirmedSend={(job: DiscoveredJob) => {
          const now = new Date().toISOString();
          setApplications(previous => {
            const exists = previous.some(a => (a.sourceUrl && a.sourceUrl === job.sourceUrl) ||
              (a.company.toLocaleLowerCase() === job.company.toLocaleLowerCase() &&
               a.role.toLocaleLowerCase() === job.role.toLocaleLowerCase()));
            if (exists) return previous.map(app =>
              (app.sourceUrl && app.sourceUrl === job.sourceUrl) ||
              (app.company.toLocaleLowerCase() === job.company.toLocaleLowerCase() &&
               app.role.toLocaleLowerCase() === job.role.toLocaleLowerCase())
                ? { ...app, status: 'Applied' as const, appliedOn: todayLocal(), updatedAt: now,
                    notes: (app.notes + '\nUser confirmed submission; not externally verified by APP-AI.').slice(0, 4000) }
                : app);
            return [createApplication({
              ...EMPTY_FIELDS, company: job.company, role: job.role,
              location: job.location, sourceUrl: job.sourceUrl,
              status: 'Applied', appliedOn: todayLocal(),
              notes: 'User confirmed submission; not independently verified by APP-AI. Source: ' + job.source,
            }, now), ...previous];
          });
        }} />

        <details className="legacy-agent-details">
          <summary>CV profile and manual vacancy tools (private)</summary>
        <AgentPanel applications={applications} onSaveLead={lead => {
          const now = new Date().toISOString();
          setApplications(previous => [createApplication(lead, now), ...previous]);
          setMessage('Agent saved a Wishlist lead; it has not been submitted.');
        }} />

        </details>

        <section className="pipeline" aria-labelledby="pipeline-title">
          <div className="section-heading pipeline-heading">
            <div><span className="eyebrow">STAY ON TOP OF THINGS</span><h2 id="pipeline-title">Your applications <span className="heading-count">{visible.length}</span></h2></div>
            <div className="action-row">
              <button type="button" className="outline-button" onClick={downloadCsv}>↓ Export CSV</button>
              <label className="outline-button import-button" htmlFor="csv-upload">↑ Import CSV</label>
              <input id="csv-upload" ref={importRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={uploadCsv} aria-label="Import application CSV" />
            </div>
          </div>

          <div className="filter-bar">
            <label className="search-box" htmlFor="job-search"><span aria-hidden="true">⌕</span><input id="job-search" type="search" placeholder="Search jobs, companies, notes..." value={query} onChange={e => setQuery(e.target.value)} /></label>
            <label className="select-filter">Status <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value as FilterStatus)}>
              <option value="All">All statuses</option>{STATUSES.map(status => <option key={status}>{status}</option>)}
            </select></label>
            <label className="select-filter">Sort <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
              <option value="updated">Recently updated</option><option value="company">Company A–Z</option><option value="deadline">Nearest deadline</option><option value="followUp">Nearest follow-up</option>
            </select></label>
            <label className="attention-toggle"><input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} /> Due only</label>
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-symbol" aria-hidden="true">✦</div>
              <h3>{applications.length ? 'No matching applications' : 'A fresh start for your next opportunity'}</h3>
              <p>{applications.length ? 'Adjust the filters or search to find a different application.' : 'Add your first application to begin tracking every step of your job search.'}</p>
              {!applications.length && <button type="button" className="primary-button" onClick={openNew}>+ Add first application</button>}
              {!!applications.length && <button type="button" className="subtle-button" onClick={() => { setQuery(''); setSelectedStatus('All'); setAttentionOnly(false); }}>Clear filters</button>}
            </div>
          ) : (
            <div className="job-list">
              {visible.map(job => {
                const due = needsAttention(job, today);
                const url = validWebUrl(job.sourceUrl);
                return (
                  <article className="job-card" key={job.id}>
                    <div className="job-avatar" aria-hidden="true">{job.company.slice(0, 1).toUpperCase()}</div>
                    <div className="job-main">
                      <div className="job-title-row"><h3>{job.role}</h3><span className={statusStyle(job.status)}>{job.status}</span>{due && <span className="due-tag">● Needs attention</span>}</div>
                      <p className="company-name">{job.company}{job.location ? ' · ' + job.location : ''}</p>
                      <div className="job-meta">
                        {job.appliedOn && <span>Applied {dateLabel(job.appliedOn)}</span>}
                        {job.deadline && <span>Deadline {dateLabel(job.deadline)}</span>}
                        {job.followUpOn && <span>Follow up {dateLabel(job.followUpOn)}</span>}
                        {url && <a href={url} target="_blank" rel="noopener noreferrer">View posting ↗</a>}
                      </div>
                      {job.notes && <p className="job-notes">{job.notes}</p>}
                    </div>
                    <div className="job-actions">
                      <button type="button" onClick={() => openEdit(job)} aria-label={'Edit ' + job.role + ' at ' + job.company}>Edit</button>
                      <button type="button" className="danger-text" onClick={() => removeJob(job)} aria-label={'Delete ' + job.role + ' at ' + job.company}>Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <footer className="container footer"><span>APP-AI · Theme 1 · Review-first applications</span><span>No account · No paid services · Browser-local data</span></footer>
    </div>
  );
}
