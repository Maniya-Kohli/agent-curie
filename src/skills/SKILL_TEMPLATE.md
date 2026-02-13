# SKILL_TEMPLATE.md — How to Write a Skill

Skills are markdown instruction files. They describe WHEN to act and WHAT tool calls to make.
They are not code. They do not execute themselves.

---

## Required Structure

```
---
name: skill-name
description: >
  One sentence: what trigger activates this, and what it does.
version: 1.0.0
enabled: true
requires:
  env: []
  tools: [only, tools, actually, called, in, steps]
---

# Skill Name

## Trigger
Exact phrases or conditions that activate this skill.

## Steps
Numbered tool calls with exact arguments.

## Example
Concrete input → tool call mapping.
```

---

## Rules

**`requires.tools`** — only list tools that appear in the Steps. Nothing speculative.

**Tool names** — use the exact registered name only: `send_saved_image`, not `functions.send_saved_image`, not `tools.send_saved_image`. No prefixes, no namespacing.

**`description`** — must name the trigger and the action. "When user says X, do Y."

**`body`** — numbered steps referencing real tool names with real arguments. No pseudo-code.

---
