#!/usr/bin/env node
// verify-sample-book.mjs
// Three resolution checks for examples/sample-book/:
//   1. progress.json schema assertions (required arrays, enum membership)
//   2. Marker-to-ledger resolution (every [claim: EV-nnnn] in chapters has a ledger entry)
//   3. Ledger-to-SRC resolution (every source: field resolves; zero orphaned SRC records)
// Exits 0 on all-pass, 1 on any failure.

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = new URL("../examples/sample-book/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const FAIL = [];
const WARN = [];
let totalChecks = 0;

function pass(label) {
  totalChecks++;
  console.log(`  PASS  ${label}`);
}
function fail(label, detail) {
  totalChecks++;
  FAIL.push(`${label}: ${detail}`);
  console.log(`  FAIL  ${label}: ${detail}`);
}
function warn(label, detail) {
  WARN.push(`${label}: ${detail}`);
  console.log(`  WARN  ${label}: ${detail}`);
}

// ─── 1. progress.json schema assertions ──────────────────────────────────────

console.log("\n=== CHECK 1: progress.json schema assertions ===");

const progressPath = join(ROOT, ".studio/progress.json");
let progress;
try {
  progress = JSON.parse(readFileSync(progressPath, "utf8"));
  pass("progress.json parses as JSON");
} catch (e) {
  fail("progress.json parses as JSON", e.message);
  process.exit(1);
}

// version must be integer 2
if (progress.version === 2) pass("version === 2");
else fail("version === 2", `got ${progress.version}`);

// updated must be present
if (typeof progress.updated === "string" && progress.updated.length > 0) pass("updated field present");
else fail("updated field present", "missing or empty");

// chapters must be an array
if (Array.isArray(progress.chapters)) pass("chapters is array");
else fail("chapters is array", `got ${typeof progress.chapters}`);

// totals required fields
const totals = progress.totals || {};
for (const f of ["word_count", "open_claim_count", "chapters_final"]) {
  if (typeof totals[f] === "number") pass(`totals.${f} is number`);
  else fail(`totals.${f} is number`, `got ${typeof totals[f]}`);
}

// per-chapter validation
const STATUS_ENUM = ["empty", "outlined", "drafting", "drafted", "revised", "gated", "final"];
const SLUG_RE = /^[0-9]{2}-[a-z0-9-]+$/;
let totalWordCount = 0;
let totalOpenClaims = 0;

for (const ch of progress.chapters) {
  const prefix = `chapters[${ch.slug}]`;
  if (SLUG_RE.test(ch.slug)) pass(`${prefix}.slug matches pattern`);
  else fail(`${prefix}.slug matches pattern`, `got "${ch.slug}"`);

  if (STATUS_ENUM.includes(ch.status)) pass(`${prefix}.status enum valid`);
  else fail(`${prefix}.status enum valid`, `got "${ch.status}"`);

  if (typeof ch.word_count === "number" && ch.word_count >= 0) pass(`${prefix}.word_count >= 0`);
  else fail(`${prefix}.word_count >= 0`, `got ${ch.word_count}`);

  if (typeof ch.open_claim_count === "number" && ch.open_claim_count >= 0) pass(`${prefix}.open_claim_count >= 0`);
  else fail(`${prefix}.open_claim_count >= 0`, `got ${ch.open_claim_count}`);

  totalWordCount += ch.word_count;
  totalOpenClaims += ch.open_claim_count;
}

// Arithmetic coherence
if (totals.word_count === totalWordCount) pass(`totals.word_count coherent (${totalWordCount})`);
else fail("totals.word_count coherent", `totals says ${totals.word_count}, sum of chapters is ${totalWordCount}`);

if (totals.open_claim_count === totalOpenClaims) pass(`totals.open_claim_count coherent (${totalOpenClaims})`);
else fail("totals.open_claim_count coherent", `totals says ${totals.open_claim_count}, sum is ${totalOpenClaims}`);

// ─── 2. Marker-to-ledger resolution ──────────────────────────────────────────

console.log("\n=== CHECK 2: marker-to-ledger resolution ===");

// Parse evidence log into a Map: EV-nnnn -> {status, ...}
const ledgerPath = join(ROOT, "research/evidence-log.md");
const ledgerText = readFileSync(ledgerPath, "utf8");
const ledgerEntries = new Map();
const entryBlocks = ledgerText.split(/^### /m).slice(1);
for (const block of entryBlocks) {
  const headMatch = block.match(/^(EV-\d+)\s+\(([^)]+)\)/);
  if (!headMatch) continue;
  const id = headMatch[1];
  const statusMatch = block.match(/^- status:\s*(.+)$/m);
  const status = statusMatch ? statusMatch[1].trim() : null;
  ledgerEntries.set(id, { status });
}
console.log(`  INFO  Evidence log: ${ledgerEntries.size} entries found`);

// Scan all chapter files for [claim: EV-nnnn] markers
const chaptersDir = join(ROOT, "chapters");
const chapterFiles = existsSync(chaptersDir)
  ? readdirSync(chaptersDir).filter(f => f.endsWith(".md"))
  : [];

const MARKER_RE = /\[claim:\s*(EV-\d+)\]/g;
const UNVERIFIED_RE = /\[UNVERIFIED\]/g;
const ORPHAN_SRC_RE = /\[SOURCE-UNVERIFIABLE\]/g;

let totalMarkers = 0;
let openMarkers = 0;
let unverifiedTags = 0;
let orphanSrcTags = 0;
const markerDetail = [];

for (const f of chapterFiles) {
  const text = readFileSync(join(chaptersDir, f), "utf8");
  const lines = text.split("\n");
  let fileMarkers = 0;

  // Check for [UNVERIFIED] tags
  const unv = (text.match(UNVERIFIED_RE) || []).length;
  if (unv > 0) {
    fail(`${f}: [UNVERIFIED] tags`, `found ${unv}; zero required in clean fixture`);
    unverifiedTags += unv;
  }

  // Check for orphan [SOURCE-UNVERIFIABLE] tags
  const svMatches = text.match(ORPHAN_SRC_RE) || [];
  // Per grammar: [SOURCE-UNVERIFIABLE] must be paired with [claim: EV-nnnn] on the same line
  for (const line of lines) {
    if (/\[SOURCE-UNVERIFIABLE\]/.test(line) && !/\[claim:\s*EV-\d+\]/.test(line)) {
      fail(`${f}: orphan [SOURCE-UNVERIFIABLE]`, `line without paired [claim: EV-nnnn]: "${line.trim()}"`);
      orphanSrcTags++;
    }
  }

  // Resolve [claim: EV-nnnn] markers
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(text)) !== null) {
    totalMarkers++;
    fileMarkers++;
    const evId = m[1];
    if (!ledgerEntries.has(evId)) {
      fail(`${f}: [claim: ${evId}]`, "no matching entry in evidence-log.md");
      openMarkers++;
    } else {
      const { status } = ledgerEntries.get(evId);
      // verified and interpretation are both "resolved" in the golden fixture
      if (status === "verified" || status === "interpretation") {
        pass(`${f}: [claim: ${evId}] -> status: ${status}`);
      } else {
        fail(`${f}: [claim: ${evId}]`, `status "${status}" is not resolved`);
        openMarkers++;
      }
    }
  }
  markerDetail.push(`${f}: ${fileMarkers} markers`);
}

console.log(`  INFO  Chapters scanned: ${chapterFiles.length} (${chapterFiles.join(", ")})`);
console.log(`  INFO  Total [claim: EV-nnnn] markers: ${totalMarkers}`);
console.log(`  INFO  Markers by file: ${markerDetail.join("; ")}`);
console.log(`  INFO  [UNVERIFIED] tags: ${unverifiedTags}`);
console.log(`  INFO  Orphan [SOURCE-UNVERIFIABLE] tags: ${orphanSrcTags}`);
if (openMarkers === 0) pass(`All ${totalMarkers} markers resolve to ledger entries; 0 open`);
else fail("All markers resolve", `${openMarkers} open marker(s)`);

// ─── 3. Ledger-to-SRC resolution ─────────────────────────────────────────────

console.log("\n=== CHECK 3: ledger-to-SRC resolution ===");

// Parse source records
const sourcesPath = join(ROOT, "research/sources.md");
const sourcesText = readFileSync(sourcesPath, "utf8");
const sourceRecords = new Set();
const srcBlocks = sourcesText.split(/^### /m).slice(1);
for (const block of srcBlocks) {
  const headMatch = block.match(/^(SRC-\d+)\s+/);
  if (headMatch) sourceRecords.add(headMatch[1]);
}
console.log(`  INFO  Source records: ${sourceRecords.size} found (${[...sourceRecords].join(", ")})`);

// Check every source: field in evidence-log.md resolves
let orphanEvSrc = 0;
const referencedSRCs = new Set();
for (const block of entryBlocks) {
  const headMatch = block.match(/^(EV-\d+)/);
  if (!headMatch) continue;
  const evId = headMatch[1];
  const srcMatch = block.match(/^- source:\s*(.+)$/m);
  if (!srcMatch) {
    fail(`${evId}: source field`, "missing");
    continue;
  }
  const srcVal = srcMatch[1].trim();
  if (srcVal === "none") {
    pass(`${evId}: source: none (no lookup needed)`);
    continue;
  }
  referencedSRCs.add(srcVal);
  if (sourceRecords.has(srcVal)) pass(`${evId}: source: ${srcVal} resolves`);
  else {
    fail(`${evId}: source: ${srcVal}`, "no matching record in sources.md");
    orphanEvSrc++;
  }
}

// Check for orphaned SRC records (registered but not referenced)
for (const srcId of sourceRecords) {
  if (!referencedSRCs.has(srcId)) warn(`SRC ${srcId} is registered but not referenced by any EV entry`);
  else pass(`${srcId}: referenced by at least one EV entry`);
}

if (orphanEvSrc === 0) pass(`All EV source: fields resolve; 0 orphaned SRC references`);
else fail("EV source resolution", `${orphanEvSrc} missing SRC record(s)`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n=== SUMMARY ===");
console.log(`Total checks run: ${totalChecks}`);
console.log(`PASS: ${totalChecks - FAIL.length}`);
console.log(`FAIL: ${FAIL.length}`);
console.log(`WARN: ${WARN.length}`);
if (WARN.length > 0) {
  console.log("\nWarnings:");
  WARN.forEach(w => console.log(`  - ${w}`));
}
if (FAIL.length > 0) {
  console.log("\nFailures:");
  FAIL.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log("\nAll checks passed.");
process.exit(0);
