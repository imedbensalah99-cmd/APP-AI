import test from "node:test";
import assert from "node:assert/strict";
import {analyzeCvMatch, buildMatchCsv, buildMatchJson} from "./engine.mjs";

function input(candidateEvidence, jobRequirements, roleTitle = "AML Analyst") {
  return {roleTitle, candidateEvidence, jobRequirements};
}
function evidence(id, text, confirmed = true) { return {id, text, confirmed}; }
function requirement(id, text, weight = "required") { return {id, text, weight}; }

test("fully supported requirements are counted only from confirmed evidence", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "Performed transaction monitoring for AML alerts")],
    [requirement("R1", "Transaction monitoring")]
  ));
  assert.equal(report.results[0].status, "SUPPORTED");
  assert.equal(report.summary.confirmedEvidenceCoveragePercent, 100);
  assert.deepEqual(report.results[0].confirmedEvidenceIds, ["E1"]);
});

test("partial keyword coverage is labeled PARTIAL, not a full match", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "AML operations")],
    [requirement("R1", "AML transaction monitoring")]
  ));
  assert.equal(report.results[0].status, "PARTIAL");
  assert.equal(report.results[0].confirmedCoveragePercent, 33);
});

test("unconfirmed CV statements never contribute to the confirmed coverage score", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "Transaction monitoring", false)],
    [requirement("R1", "Transaction monitoring")]
  ));
  assert.equal(report.results[0].status, "UNVERIFIED");
  assert.equal(report.results[0].confirmedCoveragePercent, 0);
  assert.equal(report.results[0].unconfirmedPotentialPercent, 100);
  assert.equal(report.summary.confirmedEvidenceCoveragePercent, 0);
});

test("required gaps are explicit and preferred gaps do not inflate the required count", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "Customer service")],
    [
      requirement("R1", "Sanctions screening", "required"),
      requirement("R2", "SQL reporting", "preferred")
    ]
  ));
  assert.equal(report.summary.gapCount, 2);
  assert.equal(report.summary.requiredGaps, 1);
});

test("Arabic diacritics, tatweel and common letter variants normalize safely", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "مُراقَبة المعاملات")],
    [requirement("R1", "مراقبة المعاملات")]
  ));
  assert.equal(report.results[0].status, "SUPPORTED");
  assert.equal(report.summary.confirmedEvidenceCoveragePercent, 100);
});

test("no semantic synonym is invented when keywords do not overlap", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "Customer relationship support")],
    [requirement("R1", "Transaction monitoring")]
  ));
  assert.equal(report.results[0].status, "GAP");
  assert.equal(report.results[0].confirmedCoveragePercent, 0);
});

test("CSV export quotes fields and neutralizes spreadsheet formula starters", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "AML transaction monitoring")],
    [requirement("R1", '=HYPERLINK("https://example.invalid","open")')]
  ));
  const csv = buildMatchCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://example.invalid\"\",\"\"open\"\")\""));
  assert.ok(csv.endsWith("\r\n"));
});

test("JSON export does not include raw CV evidence statements", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "Private candidate statement: unique phrase 84921")],
    [requirement("R1", "Private candidate statement")]
  ));
  const json = buildMatchJson(report);
  assert.ok(json.includes("\"confirmedEvidenceIds\": ["));
  assert.ok(!json.includes("unique phrase 84921"));
});

test("rejects unknown fields, duplicate IDs and invalid priority values", () => {
  assert.throws(() => analyzeCvMatch({...input(
    [evidence("E1", "AML monitoring")],
    [requirement("R1", "AML monitoring")]
  ), provider: "paid"}), /optional roleTitle only/);
  assert.throws(() => analyzeCvMatch(input(
    [evidence("E1", "AML monitoring"), evidence("E1", "CDD")],
    [requirement("R1", "AML monitoring")]
  )), /ids must be unique/);
  assert.throws(() => analyzeCvMatch(input(
    [evidence("E1", "AML monitoring")],
    [{id: "R1", text: "AML monitoring", weight: "critical"}]
  )), /weight/);
});

test("enforces per-entry and collection bounds", () => {
  assert.throws(() => analyzeCvMatch(input(
    [evidence("E1", "x".repeat(301))],
    [requirement("R1", "AML")]
  )), /1-300/);
  assert.throws(() => analyzeCvMatch(input(
    Array.from({length: 201}, (_, i) => evidence("E" + i, "AML monitoring")),
    [requirement("R1", "AML")]
  )), /1-200/);
  assert.throws(() => analyzeCvMatch(input(
    [evidence("E1", "AML monitoring")],
    Array.from({length: 101}, (_, i) => requirement("R" + i, "AML"))
  )), /1-100/);
});

test("enforces total serialized input size and rejects control characters", () => {
  assert.throws(() => analyzeCvMatch(input(
    Array.from({length: 200}, (_, i) => evidence("E" + i, "x".repeat(300))),
    [requirement("R1", "AML")]
  )), /64 KiB/);
  assert.throws(() => analyzeCvMatch(input(
    [evidence("E1", "AML\u0000monitoring")],
    [requirement("R1", "AML")]
  )), /printable/);
});

test("weights affect the evidence coverage aggregate, not the per-requirement labels", () => {
  const report = analyzeCvMatch(input(
    [evidence("E1", "AML monitoring")],
    [
      requirement("R1", "AML monitoring", "required"),
      requirement("R2", "SQL reporting", "optional")
    ]
  ));
  assert.equal(report.results[0].status, "SUPPORTED");
  assert.equal(report.results[1].status, "GAP");
  assert.equal(report.summary.confirmedEvidenceCoveragePercent, 75);
});
