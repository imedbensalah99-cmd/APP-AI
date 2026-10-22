/** Evidence-led application channels. A listed email is not automatically an official HR address. */
export type ApplicationChannel =
  | { kind: 'email_candidate'; email: string; sourceUrl: string; verified: false; evidence: 'job_ad' }
  | { kind: 'website_only'; sourceUrl: string; verified: false; evidence: 'job_ad' };

const ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const GENERAL = /^(?:info|support|help|contact|privacy|abuse|security|newsletter|hello|sales|billing|no-?reply|donotreply)@/i;
const APPLICATION = /(?:recruit(?:ment|er|ing)?|careers?|jobs?|hiring|talent|resum[eé]|curriculum.vitae|\bcv\b|apply|application|send.{0,20}(?:email|cv|resume))/i;

export function resolveApplicationChannel(
  description: string,
  sourceUrl: string,
): ApplicationChannel {
  const text = description.slice(0, 30000);
  const emails = [...text.matchAll(ADDRESS)];
  for (const match of emails) {
    const email = match[0].trim();
    const local = email.split('@')[0]?.toLowerCase() || '';
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 120), Math.min(text.length, index + email.length + 120));
    if (email.length > 254 || GENERAL.test(email) || /\.(?:example|test|invalid)$/i.test(email)) continue;
    if (!APPLICATION.test(context) && !/^(?:hr|recruitment|recruiting|careers|jobs|talent|hiring|apply|applications?)$/.test(local)) continue;
    return { kind: 'email_candidate', email, sourceUrl, verified: false, evidence: 'job_ad' };
  }
  return { kind: 'website_only', sourceUrl, verified: false, evidence: 'job_ad' };
}

export function channelForJob(job: { sourceUrl: string; description: string; applicationChannel?: ApplicationChannel }): ApplicationChannel {
  const channel = job.applicationChannel;
  if (channel && channel.sourceUrl === job.sourceUrl &&
    (channel.kind === 'website_only' || (channel.kind === 'email_candidate' && !!channel.email))) return channel;
  return resolveApplicationChannel(job.description, job.sourceUrl);
}
