// what-it-is:   shared agent-identity resolution and write-scope table (ADR-0007)
// what-it-does: single home for (a) resolving which plugin agent, if any, fired a
//               hook event, (b) the per-agent write-scope table backing the
//               PreToolUse write-containment constraint (F-AG-01), and (c) the
//               web-gate agent membership (F-AG-02). Both hooks/pre-tool-use.mjs
//               and hooks/post-tool-batch.mjs import from here so the parsing
//               logic and the agent lists are not duplicated - the audit found
//               four independent hardcoded CLI lists elsewhere in the repo, and
//               this module is what prevents that class of drift here.
//
// evidence:     (local working notes, not published) (2026-08-09 live platform
//               probe). PF-2 established that plugin agents report a namespaced
//               agent_type ("nonfiction-studio:<slug>"); PF-1/PF-3 established
//               that generic subagents report an unnamespaced type
//               ("general-purpose") and the parent session carries neither
//               field. See docs/adr/ADR-0007-agent-identity-resolution.md.

import { sep, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// foldForCompare: case-fold a path for comparison only on case-insensitive
// filesystems (F-HK-13). Folding unconditionally WIDENS matching on a
// case-sensitive filesystem (POSIX), which is the wrong direction for a
// security guard: a path that differs only in case from an allowed prefix is
// a DIFFERENT path on Linux/macOS and must not be treated as contained.
// platformOverride is injectable so tests can drive both branches
// deterministically regardless of the host OS; production call sites omit it
// and get the real process.platform.
//
// This is the single home for this helper (previously duplicated: this
// module's own checkAgentWriteConstraint re-implemented the same
// win32-only-lowercase logic inline rather than importing it, which is
// exactly the class of drift this module exists to prevent per the header
// comment above). hooks/pre-tool-use.mjs imports it from here and re-exports
// it under the same name so existing callers of
// `import('../../hooks/pre-tool-use.mjs')` are unaffected.
// ---------------------------------------------------------------------------
export function foldForCompare(p, platformOverride = process.platform) {
  return platformOverride === 'win32' ? p.toLowerCase() : p;
}

// ---------------------------------------------------------------------------
// PLUGIN_NAMESPACE: the plugin slug prefix the platform prepends to agent_type
// for THIS plugin's own agents (probe PF-2, see the evidence note above).
// Equals the "name" field in .claude-plugin/plugin.json. Matching on this
// exact prefix is what lets resolveActiveAgent tell "this plugin's own agent"
// apart from a user's unrelated agent that happens to share a slug.
// ---------------------------------------------------------------------------
export const PLUGIN_NAMESPACE = 'nonfiction-studio';

const NAMESPACE_PREFIX = PLUGIN_NAMESPACE + ':';

// ---------------------------------------------------------------------------
// resolveActiveAgent(event): ENFORCEMENT-facing resolution.
// Returns the plugin agent slug (the part after "nonfiction-studio:") when
// event.agent_type is a string beginning with the namespace prefix; returns
// null in every other case: field absent, empty, not a string, or an
// unnamespaced type such as "general-purpose". Rationale: only this plugin's
// own agents are subject to this plugin's constraints (roadmap row 1.1, no
// false denies under ambiguity) - a user's unrelated agent that happens to
// share a name must not be constrained.
// ---------------------------------------------------------------------------
export function resolveActiveAgent(event) {
  const agentType = event && typeof event.agent_type === 'string' ? event.agent_type : '';
  if (!agentType || !agentType.startsWith(NAMESPACE_PREFIX)) return null;
  const slug = agentType.slice(NAMESPACE_PREFIX.length);
  return slug || null;
}

// ---------------------------------------------------------------------------
// resolveAgentLabel(event): ATTRIBUTION-facing resolution (D-10 compliance
// layer), NOT enforcement. Returns the RAW event.agent_type string when
// present and non-empty, else null. Deliberately keeps the namespace prefix
// and deliberately keeps unnamespaced types like "general-purpose" - the
// ai-use-log should record what actually fired, not a filtered view of it.
// ---------------------------------------------------------------------------
export function resolveAgentLabel(event) {
  const agentType = event && typeof event.agent_type === 'string' ? event.agent_type : '';
  return agentType ? agentType : null;
}

// ---------------------------------------------------------------------------
// AGENT_WRITE_SCOPES (F-AG-01): per-agent allowed write-prefix table, D-13
// (security posture). Values are book-root-relative directory prefixes each
// agent's OWN shipped prose already claims - these are the claims this table
// makes true. Verified against each agent file's own prose (source of truth
// column) before trusting this table; see docs/adr/ADR-0007-agent-identity-resolution.md
// for the full verification note.
//
//   slug                 allowed prefixes            source of truth
//   research-librarian   research/, .studio/         agents/research-librarian.md:73-74
//   drafting-partner     chapters/                    agents/drafting-partner.md:69-71
//   line-editor          chapters/                    agents/line-editor.md:62-64
//   structure-architect  structure/, research/        agents/structure-architect.md:67-69
//   thesis-architect     context/, structure/         agents/thesis-architect.md:64-66
//
// Deliberately ABSENT (absence means UNCONSTRAINED, not denied - roadmap row
// 1.1, no false denies under ambiguity):
//   fact-checker       - prose declares writes spanning research/, chapters/,
//                        .studio/fact-check-reports/, and .claude/agent-memory/
//                        with no path-guard citation; constraining it would be
//                        a behavior change the prose does not authorize. It IS
//                        web-gated (see WEB_GATED_AGENTS / isWebGatedAgent below).
//   interviewer        - claims no path guard.
//   voice-capture       - claims no path guard.
//   citation-manager    - a Phase 2 agent that does not exist on disk yet.
// ---------------------------------------------------------------------------
export const AGENT_WRITE_SCOPES = {
  'research-librarian': ['research/', '.studio/'],
  'drafting-partner': ['chapters/'],
  'line-editor': ['chapters/'],
  'structure-architect': ['structure/', 'research/'],
  'thesis-architect': ['context/', 'structure/']
};

// ---------------------------------------------------------------------------
// WEB_GATED_AGENTS (F-AG-02, web gate unenforced): agents that ship
// WebSearch/WebFetch tools and are therefore subject to the web gate. A
// DIFFERENT question from AGENT_WRITE_SCOPES membership (fact-checker and
// citation-manager are web-gated but NOT write-scoped; the reverse also
// holds for the other four table agents). Moved here unchanged from the
// former RESEARCH_AGENTS set in hooks/pre-tool-use.mjs so both hooks share
// one definition instead of drifting independently.
// ---------------------------------------------------------------------------
const WEB_GATED_AGENTS = new Set(['research-librarian', 'fact-checker', 'citation-manager']);

// ---------------------------------------------------------------------------
// isWebGatedAgent(agentSlug): true when the slug ships web tools and is
// therefore subject to the F-AG-02 web gate.
// ---------------------------------------------------------------------------
export function isWebGatedAgent(agentSlug) {
  return Boolean(agentSlug) && WEB_GATED_AGENTS.has(agentSlug);
}

// ---------------------------------------------------------------------------
// checkAgentWriteConstraint(agentSlug, realTargetAbsPath, bibleRoot, platformOverride)
// Returns null to ALLOW, or a deny-reason string naming the slug and its
// allowed prefixes. Allows unconditionally when agentSlug is falsy or absent
// from AGENT_WRITE_SCOPES (absence means unconstrained; this preserves
// today's behavior for agents with no declared scope).
//
// realTargetAbsPath MUST be the REAL (symlink-resolved) target, not the
// lexical one - callers pass the F-HK-04 realpath value so a symlink cannot
// carry a constrained agent's write outside its scope while passing only a
// lexical check. Both realTargetAbsPath and bibleRoot are also run through
// resolve() before the prefix check (matching the resolve() normalization
// the replaced checkResearchAgentConstraint performed), so a lexically
// unnormalized path containing ".." cannot pass the containment check via a
// naive string-prefix match while really resolving outside the agent's
// scope - resolve() is defense in depth here: production callers already
// pass a realpathed target, but this function is an exported member of a
// shared lib and must not trust every future caller to have done that first.
//
// platformOverride defaults to process.platform and is folded via
// foldForCompare (F-HK-13): case-fold only on win32, never on a
// case-sensitive filesystem, since unconditional folding would widen
// containment the wrong way on POSIX.
// ---------------------------------------------------------------------------
export function checkAgentWriteConstraint(agentSlug, realTargetAbsPath, bibleRoot, platformOverride = process.platform) {
  if (!agentSlug || !Object.prototype.hasOwnProperty.call(AGENT_WRITE_SCOPES, agentSlug)) {
    return null;
  }

  const rootNorm = foldForCompare(resolve(bibleRoot), platformOverride);
  const targetNorm = foldForCompare(resolve(realTargetAbsPath), platformOverride);
  const prefixes = AGENT_WRITE_SCOPES[agentSlug];

  const inScope = prefixes.some((prefix) => {
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const full = rootNorm + sep + foldForCompare(bare, platformOverride);
    return targetNorm === full || targetNorm.startsWith(full + sep);
  });

  if (inScope) return null;

  return (
    'Agent ' + agentSlug + ' may only write under ' + prefixes.join(', ') +
    '; attempted write to ' + realTargetAbsPath + ' denied per D-13 (security posture)'
  );
}
