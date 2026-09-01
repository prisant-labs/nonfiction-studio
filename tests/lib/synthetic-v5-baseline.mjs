// tests/lib/synthetic-v5-baseline.mjs
// what-it-is:   shared test helper (not a *.test.mjs suite; never picked up by node --test) that
//               patches a temp-clone book's .studio/config.json with a synthetic v5 stylometry
//               baseline
// what-it-does: overwrites stylometry.baseline with markers measured directly from the clone's
//               OWN chapters/*.md (measured === baseline, so every marker's z is 0 on unchanged
//               content) plus a five-rung v5 calibration ladder (P2 shape) with a generous noise
//               scale, so a later small in-test content mutation (a planted quote mismatch, an
//               appended paragraph) still cannot push a marker's z past a reasonable threshold.
//               regime defaults to "book": P9 (ADR-0012 implementation wave, (local working notes, not published))
//               documents the sample book's own sparse first-person rate genuinely landing it in
//               book regime as the intended, honest shipped-demo behavior, and every fixture this
//               helper is used against (golden sample-book and the examples/fixtures/* siblings)
//               carries a similarly small aggregate word count, so patched clones land the same
//               way and their stylometry check reports pass-with-advice below the
//               MIN_BOOK_VERDICT_WORDS floor regardless of the noise-scale margin.
// why:          ADR-0012 implementation wave Task 4 (voice verdict scope): every committed
//               examples/ fixture still carries a marker_set_version 4 baseline with no
//               calibration ladder (recapturing those baselines is Task 5's job, tracked
//               separately). Once hooks/lib/gate-engine.mjs correctly calls the v5 computeDrift,
//               scoring against that stale baseline throws StaleBaselineError inside the
//               stylometry check, which -- per the existing, UNCHANGED engine-error handling --
//               forces the whole gate run's exit code to 2, even for tests whose actual subject
//               is claim_coverage, continuity, prompt_scrub, or state_coherence, not stylometry
//               at all. This helper patches only an ephemeral OS-temp CLONE's config.json; it
//               never touches any file under examples/ itself, so Task 5's own fixture-recapture
//               work is untouched. Ratified deviation outside Task 4's nominal file list -- see
//               "Concerns for the coordinator" in (local working notes, not published).
// used-by:      tests/engines/gate.test.mjs, tests/hooks/stop-gate.test.mjs (and any sibling
//               integration suite that spawns bin/ns-gate or hooks/stop-gate.mjs against a
//               cloned examples/ fixture and does not itself intend to exercise stylometry)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { measureBook } from '../../hooks/lib/stylometry-engine.mjs';

const MARKER_NAMES = [
  'function_word_rate', 'contraction_rate', 'first_person_rate', 'second_person_rate',
  'type_token_ratio', 'avg_word_length', 'avg_sentence_length', 'punctuation_rate',
];

const SPANS = [550, 1100, 2200, 4400, 8800];

// Generous by design (see file header): the safety margin against small post-patch content
// mutations, not the mechanism that keeps a patched clone passing -- that mechanism is the
// MIN_BOOK_VERDICT_WORDS floor, which every fixture this helper targets sits well under.
const NOISE_SCALE = 50.0;
const BLOCK_THRESHOLD = 3.0;

/**
 * Overwrites <cloneDir>/.studio/config.json's stylometry.baseline with a synthetic, self-
 * consistent v5 baseline (measured from the clone's own current chapters/*.md) and removes
 * thresholds.drift_score_max (P7's retired knob) so its deprecation notice does not appear
 * inside tests that are not specifically exercising it. No-ops silently when the clone has no
 * readable config.json or no chapters/*.md files -- nothing to patch in either case.
 *
 * @param {string} cloneDir - absolute path to a TEMP CLONE (never examples/ in place)
 * @param {{ regime?: 'book'|'chapter' }} [opts]
 */
export function writeSyntheticV5Baseline(cloneDir, opts = {}) {
  const regime = opts.regime || 'book';
  const configPath = join(cloneDir, '.studio', 'config.json');

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return;
  }

  const chapterDir = join(cloneDir, 'chapters');
  let texts;
  try {
    texts = readdirSync(chapterDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => readFileSync(join(chapterDir, f), 'utf8'));
  } catch {
    texts = [];
  }
  if (texts.length === 0) return;

  const markers = measureBook(texts);

  const noiseScales = {};
  const blockThresholds = {};
  for (const span of SPANS) {
    const scales = {};
    for (const marker of MARKER_NAMES) scales[marker] = NOISE_SCALE;
    noiseScales[String(span)] = scales;
    blockThresholds[String(span)] = BLOCK_THRESHOLD;
  }

  config.stylometry = config.stylometry || {};
  config.stylometry.baseline = {
    markers,
    marker_set_version: 5,
    captured: '2026-08-30T00:00:00Z',
    sample_count: texts.length,
    calibration: {
      spans: SPANS,
      noise_scales: noiseScales,
      block_thresholds: blockThresholds,
      detectability_auc: regime === 'book' ? 0.70 : 0.98,
      regime,
      replicates: 1000,
      seed: 4242,
    },
  };

  if (config.thresholds && Object.prototype.hasOwnProperty.call(config.thresholds, 'drift_score_max')) {
    delete config.thresholds.drift_score_max;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
