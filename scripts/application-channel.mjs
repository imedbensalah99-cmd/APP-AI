// Public job-ad extraction only. This never claims recruiter email verification.
export function detectContact(description, sourceUrl) {
  const s = String(description || '').slice(0, 30000);
  const pattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const m of s.matchAll(pattern)) {
    const email = m[0];
    const local = email.split('@')[0].toLowerCase();
    const ctx = s.slice(Math.max(0, m.index - 120), Math.min(s.length, m.index + email.length + 120));
    if (email.length > 254 || /^(?:info|support|help|contact|privacy|abuse|security|newsletter|hello|sales|billing|no-?reply|donotreply)@/i.test(email)) continue;
    if (/\.(?:example|test|invalid)$/i.test(email)) continue;
    if (!/(?:send|email|submit|forward|apply)\s+(?:your\s+)?(?:cv|resume|application|details)\s+(?:to|at)\b|apply\s+(?:by\s+)?email|applications?\s+(?:to|at)\b|(?:email|send)\s+your\s+(?:cv|resume)/i.test(ctx) &&
        !/^(?:hr|recruitment|recruiting|careers|jobs|talent|hiring|apply|applications?)$/.test(local)) continue;
    return {kind:'email_candidate',email,sourceUrl,verified:false,evidence:'job_ad'};
  }
  return {kind:'website_only',sourceUrl,verified:false,evidence:'job_ad'};
}
