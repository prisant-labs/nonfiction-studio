---
name: REPLACE-with-kebab-case-name-matching-this-file
description: REPLACE - Use this agent when [conditions]. Typical triggers include [scenario-A in prose], [scenario-B in prose], and [scenario-C in prose]. See "When to invoke" in the agent body for worked scenarios.
model: REPLACE-model
# model choices: inherit (recommended default) | haiku | sonnet | opus
# Per D-18 (in-plugin model routing) in (local working notes, not published): default inherit; haiku for lightweight
# scan passes; sonnet for drafting and editing work; opus for deep synthesis only.
color: REPLACE-color
# color choices - all eight valid values: red, blue, green, yellow, purple, orange, pink, cyan
# Pillar mapping per D-19 (colors by pillar) in (local working notes, not published):
#   Intake: blue | Structure: purple | Research: cyan | Drafting/Voice: orange
#   Production: green | Governance: yellow | safety agents: red
# pink is available for agents without a clear pillar alignment.
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

## Steps

1. First step.
2. Second step.
