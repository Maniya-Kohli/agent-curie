// src/skills/manager.ts

import { registry } from "../tools/registry";
import { skillLoader } from "./loader";
import { skillRegistry } from "./registry";
import { logger } from "../utils/logger";

// === Tool Handlers ===

function handleSkillList(): string {
  return skillRegistry.formatSkillList();
}

function handleSkillEnable(input: { name: string }): string {
  const success = skillLoader.setEnabled(input.name, true);
  return success
    ? `✅ Skill "${input.name}" enabled.`
    : `❌ Could not enable "${input.name}". Skill not found.`;
}

function handleSkillDisable(input: { name: string }): string {
  const success = skillLoader.setEnabled(input.name, false);
  return success
    ? `✅ Skill "${input.name}" disabled.`
    : `❌ Could not disable "${input.name}". Skill not found.`;
}

function handleSkillCreate(input: {
  name: string;
  description: string;
  tools: string[];
  body: string;
}): string {
  try {
    const fs = require("fs");
    const path = require("path");

    const skillDir = path.join(
      process.cwd(),
      "workspace",
      "skills",
      input.name,
    );

    if (fs.existsSync(skillDir)) {
      return `❌ Skill "${input.name}" already exists. Use memory_write to update its SKILL.md.`;
    }

    fs.mkdirSync(skillDir, { recursive: true });

    const toolsList =
      input.tools.length > 0
        ? input.tools.join(", ")
        : "memory_read, memory_write, memory_search";

    const skillMd = `---
name: ${input.name}
description: >
  ${input.description}
version: 1.0.0
enabled: true
requires:
  env: []
  tools: [${toolsList}]
---

# ${input.name} Skill

> **Skills are instruction-only.** This skill works by composing existing tools.
> It does not contain executable code. All actions happen via tool calls.
> Available tools: ${toolsList}

${input.body}
`;

    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
    skillLoader.reload();

    logger.info(`Created new skill: ${input.name}`);
    return `✅ Created skill "${input.name}" at workspace/skills/${input.name}/SKILL.md — active now.\n\nRemember: this skill works by calling tools (${toolsList}). Test it by triggering its description.`;
  } catch (error: any) {
    logger.error(`Failed to create skill: ${error}`);
    return `❌ Error creating skill: ${error.message}`;
  }
}

// === Self-Registration ===

registry.register({
  name: "skill_list",
  description:
    "List all installed skills. " +
    "Output: name, version, status (active / disabled / unavailable), and description for each skill.",
  category: "skills",
  input_schema: { type: "object", properties: {} },
  function: handleSkillList,
});

registry.register({
  name: "skill_enable",
  description: "Enable a previously disabled skill.",
  category: "skills",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the skill to enable" },
    },
    required: ["name"],
  },
  function: handleSkillEnable,
});

registry.register({
  name: "skill_disable",
  description: "Disable an active skill.",
  category: "skills",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the skill to disable" },
    },
    required: ["name"],
  },
  function: handleSkillDisable,
});

registry.register({
  name: "skill_create",
  description:
    "Create a new skill — a SKILL.md file that composes existing tools into a reusable workflow. " +
    "Input: name (lowercase kebab-case), description (one sentence: trigger + action), " +
    "tools (array of exact registered tool names — no prefixes, no namespacing), " +
    "body (markdown with Trigger / Steps / Example sections; each step calls a real tool with exact args). " +
    "Output: '✅ Created skill at workspace/skills/<name>/SKILL.md — active now.' or an error. " +
    "Call memory_read('skills/SKILL_TEMPLATE.md') before calling this tool and follow its structure exactly.",
  category: "skills",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Skill name (lowercase, kebab-case, e.g. 'expense-tracker')",
      },
      description: {
        type: "string",
        description:
          "One sentence: what trigger activates this skill and what it does.",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description:
          "Real registered tool names this skill calls in its steps. Only include tools that actually appear in the body.",
      },
      body: {
        type: "string",
        description:
          "Numbered markdown steps. Each step calls a real tool with exact arguments. " +
          "Follow the structure shown in skills/SKILL_TEMPLATE.md. " +
          "Include a Trigger section and an Example section.",
      },
    },
    required: ["name", "description", "tools", "body"],
  },
  function: handleSkillCreate,
});
