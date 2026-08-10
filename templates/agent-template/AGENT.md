---
# Remove all guidance comments before committing a stamped agent.
name: REPLACE-with-kebab-case-name-matching-this-file
description: REPLACE - Use this agent when [conditions]. Typical triggers include [scenario-A in prose], [scenario-B in prose], and [scenario-C in prose]. See "When to invoke" in the agent body for worked scenarios.
model: REPLACE-model
# model choices: inherit (recommended default) | haiku | sonnet | opus
# Per D-18 (in-plugin model routing), this plugin's own convention: default inherit; haiku
# for lightweight scan passes; sonnet for drafting and editing work; opus for deep synthesis only.
color: REPLACE-color
# color choices - all eight valid values: red, blue, green, yellow, purple, orange, pink, cyan
# Pillar mapping per D-19 (colors by pillar), this plugin's own convention - follow it so a
# custom agent stays visually consistent with the shipped roster:
#   Intake: blue | Structure: purple | Research: cyan | Drafting/Voice: orange
#   Production: green | Governance: yellow | safety agents: red
# pink is available for agents without a clear pillar alignment.
memory: REPLACE-or-delete
# Use `project` only for the D-09 (learning checker agents) roster: fact-checker,
# voice-guardian, continuity-checker; delete this line for all other agents. The
# platform creates .claude/agent-memory/nonfiction-studio-<agent-name>/ and the
# frontmatter field, never body text, controls the directory.
skills: REPLACE-or-delete
# Preloads FULL skill content at startup, namespaced nonfiction-studio:<skill-name>;
# delete when no preload is needed; skills with disable-model-invocation cannot be
# preloaded.
tools:
  - Read
metadata:
  version: 0.1.0
  tier: convergent
  status: active
  agent-targets:
    - claude
---

<!-- PLUGIN CONSTRAINT NOTE (PA-2 (plugin agent hooks ignored))
     The hooks, mcpServers, and permissionMode frontmatter fields are IGNORED for
     plugin-shipped agents. Do not set them here.
     - Behavior contracts belong in the system prompt below.
     - Lifecycle hooks belong in hooks/hooks.json at the plugin level.
     Delete this comment block when filling in this template.
-->

# REPLACE-with-name

## Role

One paragraph: the bounded job this subagent owns.

## When to invoke

Replace the bullets below with 2 to 4 prose scenarios that describe when the parent
agent or the harness should dispatch to this agent. Each bullet names the situation
and states what this agent does in response. Mirror the scenario keywords in the
description field above so dispatch triggering is consistent.

- **[REPLACE-scenario-A: short label].** [Describe the situation and what this agent does in response.]
- **[REPLACE-scenario-B: short label].** [Describe the situation and what this agent does in response.]
- **[REPLACE-scenario-C: short label].** [Describe the situation and what this agent does in response, or delete this bullet if two scenarios suffice.]

## Tools

Why each tool in `tools` is needed (narrowest set; Standard sec 9). Add a `chain` list
only when this subagent invokes another component, and mirror it in
`agents/_chain-permitted.yaml`.

## Reads and writes

The bible paths this agent reads and the paths it writes, each with one line on why.
Writes outside this list are contract violations; keep it exact.

## Process

1. First step.
2. Second step.

## Guardrails

The behavior limits that bind this agent, transcribed from its spec section. Include
the platform note where relevant: hooks, mcpServers, and permissionMode are ignored in
plugin agent frontmatter, so every behavioral contract lives here in the prompt.

<!-- Template shape note: amended 2026-07-18 at TSK-036 (interviewer agent) review close.
     The original four-section shape (Role / When to invoke / Tools / Steps) grew to six:
     Reads and writes plus Guardrails became first-class sections because every roster
     agent carries both contracts, and Steps was renamed Process to match the S-01
     through S-04 spec heading. The first stamped agent (interviewer) established this
     shape and the amendment standardizes it for the rest of the roster. -->

