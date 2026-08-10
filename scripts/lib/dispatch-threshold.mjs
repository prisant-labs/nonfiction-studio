// what-it-is:   the Tier B dispatch-accuracy gate
// what-it-does: a pure pass/fail decision over a graded eval batch's (passed, total) counts,
//               exported separately from scripts/run-evals.mjs so it is directly unit-testable
//               with synthetic counts and never requires a model call, a claude CLI, or an
//               evals/*.eval.json file to exercise.
// why:          roadmap row 1.12 requires that a deliberately broken dispatch table turns a
//               live Tier B run red. Before this module existed, scripts/run-evals.mjs always
//               exited 0 once every case had been graded, whatever the pass rate: dispatch
//               accuracy was advisory signal only, never a gate. 70% is the chosen threshold:
//               grading uses a small model (haiku) against an intentionally loose match (does
//               the response name the expected callee, not exact phrasing or output quality),
//               so occasional misses from a HEALTHY dispatch table are expected noise, not a
//               defect. Against the evals/ set's size when this was written (34 cases across
//               16 files, verified by counting the .eval.json cases[] arrays directly rather
//               than trusting a comment elsewhere), a healthy table can absorb roughly a third
//               of cases missing before this gate fails it, while a genuinely broken table
//               (most of an eval file, or several files, misrouting) drops well below it.
//               Chosen to catch severe breakage without flagging normal grading variance; not
//               a claim that 70% is the ceiling of a healthy table, and not pinned to the exact
//               case count above, which will drift as evals/ grows.
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
