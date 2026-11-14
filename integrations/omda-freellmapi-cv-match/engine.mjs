// Deterministic CV-to-job evidence coverage. No LLM, network, storage or external calls.
const MAX_BYTES = 64 * 1024;
const MAX_EVIDENCE = 200;
const MAX_REQUIREMENTS = 100;
const MAX_TEXT = 300;
const STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","for","with","from","by","on","at","as",
  "experience","years","year","knowledge","ability","skills","skill","work",
  "في","من","على","عن","الى","إلى","و","أو","مع","لدى","خبرة","العمل","سنوات","سنة","مهارات"
]);
const WEIGHTS = Object.freeze({required: 3, preferred: 2, optional: 1});
const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key));

function fail(message) { throw new TypeError(message); }

function cleanText(value, label) {
  if (typeof value !== "string") fail(label + " must be text");
  const text = value.trim();
  if (!text || text.length > MAX_TEXT || /[\u0000-\u001f\u007f]/u.test(text)) {
    fail(label + " must contain 1-" + MAX_TEXT + " printable characters");
  }
  return text;
}

function tokensFor(value) {
  const normalized = value.normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670]/gu, "")
    .replace(/\u0640/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .toLocaleLowerCase("en");
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(tokens.filter(token => token.length > 1 && !STOP_WORDS.has(token)));
}

function validateEntries(list, kind) {
  const isEvidence = kind === "evidence";
  const max = isEvidence ? MAX_EVIDENCE : MAX_REQUIREMENTS;
  if (!Array.isArray(list) || list.length < 1 || list.length > max) {
    fail(kind + " must contain 1-" + max + " entries");
  }
  const ids = new Set();
  return list.map((entry, index) => {
    const keys = isEvidence ? ["id", "text", "confirmed"] : ["id", "text", "weight"];
    if (!exactKeys(entry, keys)) fail(kind + "[" + index + "] has unexpected or missing fields");
    if (typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,24}$/u.test(entry.id)) {
      fail(kind + "[" + index + "] has an invalid id");
    }
    if (ids.has(entry.id)) fail(kind + " ids must be unique");
    ids.add(entry.id);
    const text = cleanText(entry.text, kind + "[" + index + "].text");
    if (isEvidence) {
      if (typeof entry.confirmed !== "boolean") fail("Evidence confirmation must be boolean");
      return {id: entry.id, text, confirmed: entry.confirmed};
    }
    if (!Object.hasOwn(WEIGHTS, entry.weight)) fail("Requirement weight must be required, preferred or optional");
    if (tokensFor(text).size === 0) fail("Requirement must contain at least one meaningful keyword");
    return {id: entry.id, text, weight: entry.weight};
  });
}

function validateInput(input) {
  if (!exactKeys(input, ["candidateEvidence", "jobRequirements", "roleTitle"])
      && !exactKeys(input, ["candidateEvidence", "jobRequirements"])) {
    fail("Input must contain candidateEvidence, jobRequirements and optional roleTitle only");
  }
  let encoded;
  try { encoded = new TextEncoder().encode(JSON.stringify(input)); }
  catch { fail("Input could not be serialized"); }
  if (encoded.byteLength > MAX_BYTES) fail("Input exceeds the 64 KiB limit");
  const candidateEvidence = validateEntries(input.candidateEvidence, "evidence");
  const jobRequirements = validateEntries(input.jobRequirements, "requirements");
  const roleTitle = input.roleTitle === undefined || input.roleTitle === ""
    ? "" : cleanText(input.roleTitle, "roleTitle");
  return {candidateEvidence, jobRequirements, roleTitle};
}

function coverage(requiredTokens, evidenceTokens) {
  if (!requiredTokens.size) return 0;
  let matched = 0;
  for (const token of requiredTokens) if (evidenceTokens.has(token)) matched++;
  return matched / requiredTokens.size;
}

function analyzeCvMatch(input) {
  const data = validateInput(input);
  const evidence = data.candidateEvidence.map(item => ({...item, tokens: tokensFor(item.text)}));
  const results = data.jobRequirements.map(requirement => {
    const requiredTokens = tokensFor(requirement.text);
    const scored = evidence.map(item => ({
      id: item.id,
      confirmed: item.confirmed,
      coverage: coverage(requiredTokens, item.tokens)
    }));
    const confirmed = scored.filter(item => item.confirmed);
    const unconfirmed = scored.filter(item => !item.confirmed);
    const bestConfirmed = Math.max(0, ...confirmed.map(item => item.coverage));
    const bestUnconfirmed = Math.max(0, ...unconfirmed.map(item => item.coverage));
    let status = "GAP";
    if (bestConfirmed >= 0.75) status = "SUPPORTED";
    else if (bestConfirmed > 0) status = "PARTIAL";
    else if (bestUnconfirmed > 0) status = "UNVERIFIED";
    return {
      id: requirement.id,
      requirement: requirement.text,
      priority: requirement.weight,
      status,
      confirmedCoveragePercent: Math.round(bestConfirmed * 100),
      unconfirmedPotentialPercent: Math.round(bestUnconfirmed * 100),
      confirmedEvidenceIds: confirmed.filter(item => item.coverage >= 0.5).map(item => item.id),
      unconfirmedEvidenceIds: unconfirmed.filter(item => item.coverage >= 0.5).map(item => item.id)
    };
  });
  const totalWeight = data.jobRequirements.reduce((sum, item) => sum + WEIGHTS[item.weight], 0);
  const weightedCoverage = results.reduce((sum, item) =>
    sum + (WEIGHTS[item.priority] * item.confirmedCoveragePercent), 0);
  const summary = {
    requirementCount: results.length,
    supportedCount: results.filter(item => item.status === "SUPPORTED").length,
    partialCount: results.filter(item => item.status === "PARTIAL").length,
    unverifiedCount: results.filter(item => item.status === "UNVERIFIED").length,
    gapCount: results.filter(item => item.status === "GAP").length,
    requiredGaps: results.filter(item => item.priority === "required" && item.status !== "SUPPORTED").length,
    confirmedEvidenceCoveragePercent: Math.round(weightedCoverage / totalWeight)
  };
  return {
    schemaVersion: 1,
    roleTitle: data.roleTitle,
    summary,
    results,
    disclaimer: "Keyword evidence coverage only — not an eligibility, hiring or semantic-fit decision. User-confirmed statements are not independently verified. Review every requirement and source manually."
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/gu, '""') + '"';
}

function buildMatchCsv(report) {
  if (!isRecord(report) || !Array.isArray(report.results) || report.results.length > MAX_REQUIREMENTS) {
    fail("Invalid match report");
  }
  const rows = [
    ["Requirement", "Priority", "Status", "Confirmed coverage %", "Unconfirmed potential %", "Confirmed evidence IDs", "Unconfirmed evidence IDs"],
    ...report.results.map(item => [
      item.requirement, item.priority, item.status, item.confirmedCoveragePercent,
      item.unconfirmedPotentialPercent, (item.confirmedEvidenceIds || []).join("; "),
      (item.unconfirmedEvidenceIds || []).join("; ")
    ])
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function buildMatchJson(report) {
  if (!isRecord(report) || !Array.isArray(report.results) || report.results.length > MAX_REQUIREMENTS) {
    fail("Invalid match report");
  }
  return JSON.stringify(report, null, 2) + "\n";
}

export {
  analyzeCvMatch,
  buildMatchCsv,
  buildMatchJson,
  tokensFor,
  validateInput,
  MAX_BYTES,
  MAX_EVIDENCE,
  MAX_REQUIREMENTS,
  MAX_TEXT
};
