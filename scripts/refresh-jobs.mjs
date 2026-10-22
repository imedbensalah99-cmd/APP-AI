import { mkdir, writeFile } from 'node:fs/promises';

// Public, no-key remote-job API. This script publishes only public listings,
// never CV data, candidates, drafts, tokens or application history.
const terms = ['compliance', 'operations', 'finance', 'customer support'];
const relevant = /\b(aml|kyc|compliance|fraud|risk|financial crime|operations|administration|admin|finance|accounting|analyst|document control|data entry|customer support|customer service|recruitment|hr assistant|banking|sanctions|transaction monitoring)\b/i;
const senior = /\b(senior|sr\.?|head|director|chief|principal|lead|manager|mlro|dmlro|vp|vice president)\b/i;
const out = new Map();
const fetchedAt = new Date().toISOString();
let successes = 0;
for (const term of terms) {
  try {
    const url = 'https://himalayas.app/jobs/api/search?country=QA&sort=recent&q=' + encodeURIComponent(term);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.jobs)) throw new Error('Invalid source format');
    successes++;
    for (const j of data.jobs) {
      const role = String(j.title || '').trim();
      const company = String(j.companyName || '').trim();
      const link = String(j.applicationLink || '');
      if (!role || !company || !/^https:\/\//i.test(link) || !relevant.test(role) || senior.test(role)) continue;
      if (j.pubDate && Date.now() - j.pubDate * 1000 > 65 * 86400000) continue;
      if (j.expiryDate && Date.now() >= j.expiryDate * 1000) continue;
      const countries = Array.isArray(j.locationRestrictions) ? j.locationRestrictions : [];
      if (countries.length && !countries.some(c => String(c?.alpha2 || '').toUpperCase() === 'QA' || String(c?.name || '').toLowerCase() === 'qatar')) continue;
      const description = String(j.description || j.excerpt || '').replace(/<[^>]*>/g, ' ').slice(0, 5000);
      if (/qatari nationals? only|qataris only|qatarization only/i.test(description)) continue;
      const id = 'himalayas:' + String(j.guid || link);
      out.set(id, { id, company: company.slice(0, 120), role: role.slice(0, 120),
        location: countries.length ? 'Remote · Qatar eligible (location filter)' : 'Remote · worldwide listing',
        sourceUrl: link, description, source: 'Himalayas',
        published: j.pubDate ? new Date(j.pubDate * 1000).toISOString().slice(0, 10) : '',
        remote: true, sourceChecked: true,
        eligibility: 'Country filter only; verify employer requirements before applying.' });
    }
  } catch (error) { console.error('Source ' + term + ': ' + String(error)); }
}
if (!successes) {
  console.error('All source requests failed. Keeping previous snapshot.');
  process.exitCode = 1;
} else {
  await mkdir('public', { recursive: true });
  await writeFile('public/jobs-cache.json', JSON.stringify({ generatedAt: fetchedAt, source: 'Himalayas public API', jobs: [...out.values()] }, null, 2) + '\n');
  console.log('Fetched ' + successes + ' source categories, published ' + out.size + ' public jobs.');
}
