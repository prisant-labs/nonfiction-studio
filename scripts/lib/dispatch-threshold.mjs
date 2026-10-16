// what-it-is:   the Tier B dispatch-accuracy gate
// what-it-does: a pure pass/fail decision over a graded eval batch's (passed, total) counts,
//               exported separately from scripts/run-evals.mjs so it is directly unit-testable
//               with synthetic counts and never requires a model call, a claude CLI, or an
//               evals/*.eval.json file to exercise.
// why:          roadmap row 1.12 requires that a deliberately broken dispatch table turns a
//               live Tier B run red. Before this module existed, scripts/run-evals.mjs always
//               exited 0 once every case had been graded, whatever the pass rate: dispatch
//               accuracy was advisory signal only, never a gate.
//
//               The threshold is 70%. It was chosen, not derived, in ADR-0010 (Tier B trigger
//               and credential), and re-examined on 2026-10-14 against the graded set that
//               ADR-0018 (Tier B eval harness contract) defines: 18 chain cases across 10 files.
//               The 16 hook cases no longer count. At 70%, 13 of 18 must pass, so the gate
//               absorbs 5 misses (13 of 18 is 72%) and fails at 6 (12 of 18 is 67%). A chain
//               file holds one or two cases. Three two-case files misrouting completely therefore
//               fail the run, and one or two files misrouting pass it. The report lists every
//               failed case, and that list, not this gate, is the per-edge signal.
//
//               Three live runs under the ADR-0018 harness scored 14 of 18 (78%) before four
//               case texts were corrected, then 16 of 18 (89%) and 15 of 18 (83%). One miss
//               recurred in every run and was a real defect, since fixed (issue #22): the
//               nfs-capture-voice skill's description said it delegates only when no samples
//               are available. The other misses moved between cases from run to run. The
//               first run after the fix scored 18 of 18 (2026-10-16). The threshold is
//               deliberately not set to an observed score. It is meant to fail a table where several edges break, and
//               to absorb one genuine defect plus ordinary haiku variance, which these runs put
//               at one or two cases.
// used-by:      scripts/run-evals.mjs
// exit taxonomy: n/a (library module; the caller chooses its own exit code)

/** Fraction of graded cases that must report the expected callee for a live Tier B eval run
 *  to be considered healthy. See the module header for the rationale. */
export const DISPATCH_ACCURACY_THRESHOLD = 0.70;

/**
 * @param {number} passed - cases the grader judged correct
 * @param {number} total - cases graded (pass + fail; excludes anything that never ran)
 * @param {number} [threshold] - defaults to DISPATCH_ACCURACY_THRESHOLD
 * @returns {boolean} true iff passed/total meets or exceeds the threshold
 */
export function meetsDispatchThreshold(passed, total, threshold = DISPATCH_ACCURACY_THRESHOLD) {
  // Fail-closed on zero cases: a batch that graded nothing (e.g. every call errored
  // operationally before grading) is not evidence of a healthy dispatch table, so it must
  // not silently pass the gate the way an unguarded 0/0 division would suggest.
  if (total <= 0) return false;
  return (passed / total) >= threshold;
}
