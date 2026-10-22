// Free, server-side public-feed collector. Runs only in GitHub Actions / Node 22.
// Does not receive CV data, email addresses, access tokens, or private records.
import { writeFile, mkdir } from 'node:fs/promises';

const seen = new Set();
const jobs = [];
const errors = [];
const roles = /\b(AML|KYC|compliance|fraud|risk|finance|financial|account|operations|customer|support|admin|document|back.office|analyst|data entry)\b/i;
const senior = /\b(chief|head of|director|vice president|principal|senior manager|lead engineer|staff engineer|MLRO|DMLRO)\b/i;
const clip = (v, length = 3000) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, length) : '';
const textOnly = v => clip(v?.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ') ?? '', 6500)
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
const goodUrl = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };

function add(job) {
  if (!job.id || !job.company || !job.role || !job.sourceUrl || seen.has(job.id)) return;
  if (!roles.test(job.role) || senior.test(job.role)) return;
  seen.add(job.id);
  jobs.push(job);
}

async function download(url, type = 'json') {
  const response = await fetch(url, { signal: AbortSignal.timeout(17000), headers: { 'User-Agent': 'APP-AI-job-feed/1.0 (public info; no personal data)', 'Accept': type === 'json' ? 'application/json' : 'application/rss+xml,application/xml,text/xml' } });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return type === 'json' ? response.json() : response.text();
}

const keywords = ['AML', 'KYC', 'compliance', 'finance', 'operations', 'customer service'];
for (const keyword of keywords) {
  try {
    const url = new URL('https://himalayas.app/jobs/api/search');
    url.searchParams.set('q', keyword);
    url.searchParams.set('worldwide', 'true');
    url.searchParams.set('sort', 'recent');
    url.searchParams.set('page', '1');
    const payload = await download(url);
    if (!Array.isArray(payload.jobs)) throw new Error('Malformed job API');
    for (const item of payload.jobs) {
      const original = goodUrl(item.applicationLink);
      if (!original) continue;
      const headline = clip(item.title, 120);
      if (!headline) continue;
      const description = textOnly(item.description || item.excerpt);
      add({
        id: 'himalayas:' + clip(item.guid || original, 220),
        company: clip(item.companyName, 120) || 'Employer listed on Himalayas',
        role: headline,
        location: 'Remote — check Qatar eligibility',
        sourceUrl: original,
        description,
        postedAt: clip(item.pubDate, 60),
        source: 'Himalayas',
        kind: 'remote',
        verification: 'board-listing',
      });
    }
  } catch (e) { errors.push('Himalayas ' + keyword + ': ' + String(e.message).slice(0, 160)); }
}

// Qatar news search is a discovery LEAD, not a job vacancy verification.
// Links may be news articles, recruitment stories or stale announcements.
const qatarQueries = [
  '"Qatar" ("AML analyst" OR "KYC analyst" OR "compliance analyst") vacancy',
  '"Doha" ("banking operations" OR "accounts assistant" OR "administrative assistant") recruitment'
];
function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
const tag = (xml, name) => decodeXml((xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i')) || [,''])[1]);
for (const q of qatarQueries) {
  try {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en&gl=QA&ceid=QA:en';
    const rss = await download(url, 'xml');
    const items = rss.match(/<item>[\s\S]*?<\/item>/gi) || [];
    for (const item of items.slice(0, 20)) {
      const title = clip(textOnly(tag(item, 'title')), 120);
      const link = goodUrl(clip(tag(item, 'link'), 2048));
      if (!title || !link || !roles.test(title)) continue;
      const source = clip(textOnly(tag(item, 'source')), 70) || 'Google News';
      add({
        id: 'qatar-lead:' + link, company: 'Employer unverified',
        role: title, location: 'Qatar — verify announcement',
        sourceUrl: link, description: clip(textOnly(tag(item, 'description')), 3000),
        postedAt: clip(tag(item, 'pubDate'), 60), source: 'Google News / ' + source,
        kind: 'qatar-lead', verification: 'unverified-lead',
      });
    }
  } catch (e) { errors.push('Qatar news: ' + String(e.message).slice(0, 160)); }
}

const output = { generatedAt: new Date().toISOString(), jobs: jobs.slice(0, 160), errors };
await mkdir('public', { recursive: true });
await writeFile('public/jobs.json', JSON.stringify(output, null, 2) + '\n');
console.log('Public feed:', output.jobs.length, 'items;', errors.length, 'source errors.');
// When every source fails, don't publish a misleading empty refresh.
if (errors.length === keywords.length + qatarQueries.length) process.exitCode = 1;
