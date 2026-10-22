import { useEffect, useMemo, useState } from 'react';
import { analyzeJob, generateDraft, isValidRecruiterEmail, parseCvProfileFragment, type AgentJob } from './agent';
import { validWebUrl } from './data';
import { EMPTY_FIELDS, type ApplicationFields, type JobApplication } from './types';
import './agent.css';

const PROFILE_KEY = 'app-ai:agent-profile:v1';
const PROFILE_NAME_KEY = 'app-ai:agent-profile-name:v1';
const BLANK: AgentJob = { company: '', role: '', location: 'Doha, Qatar', sourceUrl: '', description: '' };

interface Props {
  applications: JobApplication[];
  onSaveLead: (fields: ApplicationFields) => void;
}

export default function AgentPanel({ applications, onSaveLead }: Props) {
  const [job, setJob] = useState<AgentJob>({ ...BLANK });
  const [facts, setFacts] = useState(() => {
    try { return localStorage.getItem(PROFILE_KEY) ?? ''; }
    catch { return ''; }
  });
  const [fullName, setFullName] = useState(() => {
    try { return localStorage.getItem(PROFILE_NAME_KEY) ?? ''; }
    catch { return ''; }
  });
  const [recipient, setRecipient] = useState('');
  const [officialChecked, setOfficialChecked] = useState(false);
  const [eligibilityChecked, setEligibilityChecked] = useState(false);
  const [recipientChecked, setRecipientChecked] = useState(false);
  const [notice, setNotice] = useState('');
  const [showDraft, setShowDraft] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PROFILE_KEY, facts); }
    catch { /* A private browser may prohibit storage. */ }
  }, [facts]);

  useEffect(() => {
    try { localStorage.setItem(PROFILE_NAME_KEY, fullName); }
    catch { /* A private browser may prohibit storage. */ }
  }, [fullName]);

  useEffect(() => {
    // Hash fragments do not reach the host server. Immediately remove
    // the temporary CV contents from the visible URL and browser history.
    const hash = window.location.hash;
    if (!hash.startsWith('#cv=')) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const profile = parseCvProfileFragment(hash);
    if (!profile) {
      setNotice('CV import link was invalid; nothing was changed.');
      return;
    }
    setFullName(profile.fullName);
    setFacts(profile.facts);
    setNotice('Your verified professional CV details were filled into this browser. Review them below before using any application draft.');
    window.requestAnimationFrame(() => document.getElementById('agent-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  const assessment = useMemo(() => analyzeJob(job, facts, applications), [job, facts, applications]);
  const draft = useMemo(() => generateDraft(job, facts, fullName), [job, facts, fullName]);
  const postingUrl = validWebUrl(job.sourceUrl.trim());
  const hasRequiredFields = !!job.company.trim() && !!job.role.trim();
  const canPrepare = hasRequiredFields && !!facts.trim() && !!job.description.trim();
  const canOpenMail = canPrepare && officialChecked && eligibilityChecked &&
    recipientChecked && isValidRecruiterEmail(recipient);

  function setField<K extends keyof AgentJob>(key: K, value: AgentJob[K]) {
    setJob(previous => ({ ...previous, [key]: value }));
    setNotice('');
    if (key === 'sourceUrl' || key === 'description') {
      setOfficialChecked(false);
      setEligibilityChecked(false);
    }
  }

  function saveLead() {
    if (!hasRequiredFields) { setNotice('Enter an employer and job title first.'); return; }
    if (assessment.duplicate) { setNotice('Possible duplicate. Review the existing application instead.'); return; }
    if (job.sourceUrl.trim() && !postingUrl) { setNotice('Use a valid HTTP(S) job URL.'); return; }
    const statusNotes = [
      'Prepared with APP-AI Agent (not submitted).',
      officialChecked ? 'Posting manually checked by user.' : 'Vacancy not independently verified.',
      eligibilityChecked ? 'Eligibility manually checked by user.' : 'Eligibility not confirmed.',
      assessment.matching.length ? 'Overlapping CV terms: ' + assessment.matching.join(', ') : 'No supported matching keywords found.',
      assessment.concerns.join(' '),
    ].filter(Boolean).join('\n').slice(0, 4000);
    onSaveLead({
      ...EMPTY_FIELDS, company: job.company.trim(), role: job.role.trim(), location: job.location.trim(),
      sourceUrl: postingUrl, notes: statusNotes, status: 'Wishlist',
    });
    setNotice('Saved as Wishlist, NOT Applied. No email was sent.');
  }

  async function copyDraft() {
    if (!canPrepare) { setNotice('Enter the vacancy details and your factual CV notes first.'); return; }
    try {
      await navigator.clipboard.writeText(draft);
      setNotice('Application text copied. Review, attach your CV and send only when ready.');
    } catch {
      setNotice('Clipboard unavailable. Select and copy the draft below.');
      setShowDraft(true);
    }
  }

  function openEmailDraft() {
    if (!canOpenMail) { setNotice('Verify the official posting, eligibility and recruitment address before opening email.'); return; }
    const [subject, , ...body] = draft.split('\n');
    const emailLink = 'mailto:' + recipient.trim() + '?subject=' +
      encodeURIComponent(subject.replace(/^Subject:\s*/, '')) +
      '&body=' + encodeURIComponent(body.join('\n'));
    window.location.href = emailLink;
    setNotice('Email app opened for review. APP-AI has not sent an application or attached a CV.');
  }

  return (
    <section className="agent-panel" aria-labelledby="agent-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FREE APPLICATION ASSISTANT</span>
          <h2 id="agent-heading">Job Application Agent <span className="agent-beta">Review-first</span></h2>
        </div>
      </div>
      <p className="agent-intro">Paste an official vacancy and CV-supported facts. This on-device assistant checks matching terms, flags possible duplicates, and drafts an email. It does not search the web, verify vacancies automatically, upload your CV or submit applications.</p>
      <div className="agent-grid">
        <div className="agent-form">
          <label>Full name for application
            <input value={fullName} maxLength={120} onChange={e => setFullName(e.target.value)} placeholder="Your name as on your CV" />
          </label>
          <label>Verified CV facts (kept in this browser)
            <textarea rows={5} maxLength={5000} value={facts} onChange={e => setFacts(e.target.value)} placeholder="Paste 2–4 short, factual experience/education/skills statements. Do not paste QID, address or passwords." />
          </label>
          <button className="agent-clear" type="button" onClick={() => { setFacts(''); setFullName(''); setNotice('Name and CV facts cleared from this browser profile.'); }}>Clear saved profile</button>
          <div className="agent-fields">
            <label>Employer <input maxLength={120} value={job.company} onChange={e => setField('company', e.target.value)} placeholder="Company name" /></label>
            <label>Job title <input maxLength={120} value={job.role} onChange={e => setField('role', e.target.value)} placeholder="AML Analyst" /></label>
            <label>Location <input maxLength={160} value={job.location} onChange={e => setField('location', e.target.value)} placeholder="Doha, Qatar" /></label>
            <label>Official vacancy URL <input type="url" maxLength={2048} value={job.sourceUrl} onChange={e => setField('sourceUrl', e.target.value)} placeholder="https://employer.example/jobs/..." /></label>
          </div>
          <label>Full job description / requirements
            <textarea rows={6} maxLength={12000} value={job.description} onChange={e => setField('description', e.target.value)} placeholder="Paste the job requirements from the employer's official vacancy." />
          </label>
          <label>Recruitment email (only if officially published)
            <input type="email" maxLength={254} value={recipient} onChange={e => { setRecipient(e.target.value); setRecipientChecked(false); }} placeholder="Verified recruiter address" />
          </label>
        </div>
        <div className="agent-review">
          <h3>Application readiness</h3>
          <p className="agent-quiet">Keyword overlap is not an eligibility decision, qualification proof or live vacancy verification.</p>
          <div className="agent-results">
            <p><strong>Supported overlap:</strong> {assessment.matching.length ? assessment.matching.join(', ') : 'None identified yet'}</p>
            <p><strong>Not found in CV facts:</strong> {assessment.unverified.length ? assessment.unverified.join(', ') : 'No listed keyword gaps'}</p>
          </div>
          {assessment.concerns.length > 0 && (
            <div className="agent-concerns"><strong>Review before applying</strong>
              <ul>{assessment.concerns.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <div className="agent-checklist">
            <label><input type="checkbox" checked={officialChecked} disabled={!postingUrl} onChange={e => setOfficialChecked(e.target.checked)} /> I checked that the vacancy is active on the official employer site</label>
            <label><input type="checkbox" checked={eligibilityChecked} onChange={e => setEligibilityChecked(e.target.checked)} /> I checked nationality, required experience and eligibility</label>
            <label><input type="checkbox" checked={recipientChecked} disabled={!isValidRecruiterEmail(recipient)} onChange={e => setRecipientChecked(e.target.checked)} /> I verified the recruitment email from an official source</label>
          </div>
          <div className="agent-actions">
            <button type="button" className="primary-button" disabled={!hasRequiredFields || assessment.duplicate} onClick={saveLead}>Save lead to tracker</button>
            <button type="button" className="outline-button" disabled={!canPrepare} onClick={() => setShowDraft(value => !value)}>{showDraft ? 'Hide draft' : 'Preview email'}</button>
            <button type="button" className="outline-button" disabled={!canPrepare} onClick={copyDraft}>Copy draft</button>
            <button type="button" className="outline-button" disabled={!canOpenMail} onClick={openEmailDraft}>Open email app</button>
          </div>
          {notice && <p className="agent-notice" role="status">{notice}</p>}
          {showDraft && <div className="agent-draft"><h4>Review before sending</h4><pre>{draft}</pre><p>Remove the attachment reminder, attach the real PDF CV and check the address yourself.</p></div>}
        </div>
      </div>
    </section>
  );
}
