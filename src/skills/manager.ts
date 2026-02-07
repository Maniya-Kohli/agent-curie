// src/skills/manager.ts

import { Tool } from "@anthropic-ai/sdk/resources";
import { skillLoader } from "./loader";
import { skillRegistry } from "./registry";
import { logger } from "../utils/logger";

// === Tool Definitions ===

export const SKILL_TOOL_DEFINITIONS: Tool[] = [
  {
    name: "skill_list",
    description:
      "List all installed skills and their status (active/disabled/unavailable).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "skill_enable",
    description: "Enable a previously disabled skill.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to enable",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "skill_disable",
    description:
      "Disable an active skill. It will no longer be available until re-enabled.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to disable",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "skill_create",
    description:
      "Create a new skill by generating a SKILL.md file. Use when the user asks to add a new capability, create a skill, or teach Noni something new.",
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
            "What this skill does and when to use it. Be specific about trigger words/phrases.",
        },
        body: {
          type: "string",
          description:
            "Full markdown instructions for the skill. Include data format, workflows, examples.",
        },
      },
      required: ["name", "description", "body"],
    },
  },
];

// === Tool Handlers ===

export function handleSkillList(): string {
  return skillRegistry.formatSkillList();
}

export function handleSkillEnable(input: { name: string }): string {
  const success = skillLoader.setEnabled(input.name, true);
  if (success) {
    return `✅ Skill "${input.name}" enabled.`;
  }
  return `❌ Could not enable "${input.name}". Skill not found.`;
}

export function handleSkillDisable(input: { name: string }): string {
  const success = skillLoader.setEnabled(input.name, false);
  if (success) {
    return `✅ Skill "${input.name}" disabled.`;
  }
  return `❌ Could not disable "${input.name}". Skill not found.`;
}

export function handleSkillCreate(input: {
  name: string;
  description: string;
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

    // Check if skill already exists
    if (fs.existsSync(skillDir)) {
      return `❌ Skill "${input.name}" already exists. Use memory_write to update its SKILL.md.`;
    }

    // Create directory
    fs.mkdirSync(skillDir, { recursive: true });

    // Build SKILL.md content
    const skillMd = `---
name: ${input.name}
description: >
  ${input.description}
version: 1.0.0
enabled: true
requires:
  env: []
  tools: [memory_write, memory_read, memory_search]
---

${input.body}
`;

    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

    // Reload skills so it's immediately available
    skillLoader.reload();

    logger.info(`Created new skill: ${input.name}`);
    return `✅ Created skill "${input.name}" at workspace/skills/${input.name}/SKILL.md — it's now active.`;
  } catch (error: any) {
    logger.error(`Failed to create skill: ${error}`);
    return `❌ Error creating skill: ${error.message}`;
  }
}

// === Function map ===

export const SKILL_TOOL_FUNCTIONS: Record<string, Function> = {
  skill_list: handleSkillList,
  skill_enable: handleSkillEnable,
  skill_disable: handleSkillDisable,
  skill_create: handleSkillCreate,
};
