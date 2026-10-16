// what-it-is:   the shared isolation for every live `claude -p` call that Tier B makes
// what-it-does: builds the flags that load this repository's plugin and leave the caller's own
//               configuration out, and the child environment that turns off every CLAUDE.md.
//               The caller states whether the plugin's own hooks run: the integration runner
//               keeps them on, because it tests the plugin as an author runs it; the eval runner
//               turns every hook off, because it asks a dispatch question that no hook may answer.
// why:          ADR-0018 (Tier B eval harness contract) isolated the eval runner's calls, and
//               issue #24 found the integration runner still loading the caller's settings,
//               hooks, plugins and CLAUDE.md files, and never loading this plugin at all. One
//               module for both runners keeps their isolation from drifting apart. --bare would
//               isolate in one flag but refuses OAuth, which Tier B authenticates with (ADR-0010,
//               Tier B trigger and credential). Permission flags are not shared: they follow what
//               each runner's prompts need.
// used-by:      scripts/run-evals.mjs, scripts/run-integration.mjs
// exit taxonomy: n/a (library module; callers choose their own exit code)

/**
 * The isolation flags for one live call.
 *   --plugin-dir <repoRoot>          loads the plugin under test, whatever the caller has installed
 *   --setting-sources project        leaves out user settings, and with them user hooks and plugins
 *   --settings {"disableAllHooks"}   only when pluginHooks is false: turns off the plugin's hooks too
 *   --no-session-persistence         saves nothing
 */
export function isolationArgs({ repoRoot, pluginHooks } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot === '') {
    throw new TypeError('isolationArgs: repoRoot must name the plugin root');
  }
  if (typeof pluginHooks !== 'boolean') {
    throw new TypeError('isolationArgs: pluginHooks must be true or false; the caller chooses whether the plugin hooks run');
  }
  const args = ['--plugin-dir', repoRoot, '--setting-sources', 'project'];
  if (!pluginHooks) args.push('--settings', JSON.stringify({ disableAllHooks: true }));
  args.push('--no-session-persistence');
  return args;
}

/** The child's environment: the caller's, so the credential and PATH carry through, with every
 *  CLAUDE.md turned off. --setting-sources does not cover the user's ~/.claude/CLAUDE.md; this
 *  documented variable does, and leaves authentication alone. */
export function isolatedChildEnv(baseEnv) {
  return { ...baseEnv, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' };
}
