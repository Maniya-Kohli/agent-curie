// src/skills/registry.ts

import { skillLoader, Skill } from "./loader";
import { logger } from "../utils/logger";

/**
 * Builds the skills summary that gets injected into the system prompt.
 * Keeps it compact — only names + descriptions. Full body loaded on demand.
 */
export class SkillRegistry {
  /**
   * Build compact XML summary of active skills for system prompt.
   * Token-efficient: ~100 chars per skill.
   */
  buildSkillsSummary(): string {
    const active = skillLoader.getActiveSkills();
    if (active.length === 0) return "";

    let summary = "## Available Skills\n\n";
    summary +=
      "You have specialized skills installed. When a user request matches a skill, ";
    summary +=
      'read its full instructions with memory_read("skills/<name>/SKILL.md") before acting.\n\n';
    summary += "<skills>\n";

    for (const skill of active) {
      summary += `  <skill name="${skill.meta.name}" version="${skill.meta.version}">${skill.meta.description.trim()}</skill>\n`;
    }

    summary += "</skills>\n";

    return summary;
  }

  /**
   * Get full skill body for LLM to read (via memory_read or direct injection).
   */
  getSkillInstructions(name: string): string {
    const skill = skillLoader.getSkill(name);
    if (!skill) return `Skill "${name}" not found.`;
    if (!skill.isAvailable)
      return `Skill "${name}" is not available: ${skill.unavailableReason}`;
    return skill.body;
  }

  /**
   * Format skill list for the skill_list tool response.
   */
  formatSkillList(): string {
    const all = skillLoader.getAllSkills();
    if (all.length === 0)
      return "No skills installed. Add skills to workspace/skills/";

    let output = `Installed Skills (${all.length}):\n\n`;

    for (const skill of all) {
      const status = skill.isAvailable
        ? "✅ Active"
        : `❌ ${skill.unavailableReason || "Unavailable"}`;

      output += `• ${skill.meta.name} v${skill.meta.version} — ${status}\n`;
      output += `  ${skill.meta.description.trim()}\n\n`;
    }

    return output.trim();
  }
}

export const skillRegistry = new SkillRegistry();
