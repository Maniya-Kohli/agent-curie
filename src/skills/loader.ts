// src/skills/loader.ts

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  requires: {
    env: string[];
    tools: string[];
  };
}

export interface Skill {
  meta: SkillMeta;
  dirPath: string; // absolute path to skill directory
  skillFilePath: string; // absolute path to SKILL.md
  body: string; // markdown body (after frontmatter)
  isAvailable: boolean; // requirements met?
  unavailableReason?: string;
}

const SKILLS_DIR = path.join(process.cwd(), "workspace", "skills");

/**
 * Discovers and loads skills from workspace/skills/.
 * Each skill is a directory containing a SKILL.md with YAML frontmatter.
 */
export class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  /**
   * Scan workspace/skills/ and load all SKILL.md files.
   */
  discover(): Skill[] {
    this.skills.clear();

    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      logger.info("Created workspace/skills/ directory");
      return [];
    }

    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const skill = this.loadSkillFile(skillMdPath, entry.name);
        if (skill) {
          this.skills.set(skill.meta.name, skill);
        }
      } catch (error) {
        logger.warn(`Failed to load skill "${entry.name}": ${error}`);
      }
    }

    logger.info(
      `Discovered ${this.skills.size} skill(s): ${Array.from(this.skills.keys()).join(", ")}`,
    );

    return Array.from(this.skills.values());
  }

  /**
   * Parse a single SKILL.md file.
   */
  private loadSkillFile(filePath: string, dirName: string): Skill | null {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { meta, body } = this.parseFrontmatter(raw, dirName);

    if (!meta.name || !meta.description) {
      logger.warn(`Skill "${dirName}" missing name or description, skipping`);
      return null;
    }

    // Validate requirements
    const { available, reason } = this.checkRequirements(meta);

    return {
      meta,
      dirPath: path.dirname(filePath),
      skillFilePath: filePath,
      body,
      isAvailable: available && meta.enabled,
      unavailableReason: !meta.enabled
        ? "Disabled"
        : !available
          ? reason
          : undefined,
    };
  }

  /**
   * Parse YAML frontmatter from SKILL.md.
   * Simple parser — no external dependency needed for basic YAML.
   */
  private parseFrontmatter(
    content: string,
    dirName: string,
  ): { meta: SkillMeta; body: string } {
    const defaults: SkillMeta = {
      name: dirName,
      description: "",
      version: "1.0.0",
      enabled: true,
      requires: { env: [], tools: [] },
    };

    // Check for --- delimiters
    if (!content.startsWith("---")) {
      return { meta: defaults, body: content };
    }

    const endIdx = content.indexOf("---", 3);
    if (endIdx === -1) {
      return { meta: defaults, body: content };
    }

    const frontmatter = content.substring(3, endIdx).trim();
    const body = content.substring(endIdx + 3).trim();

    // Simple YAML key-value parser
    const meta = { ...defaults };

    for (const line of frontmatter.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Handle top-level keys
      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (!match) continue;

      const [, key, value] = match;
      const cleanValue = value.replace(/^["']|["']$/g, "").trim();

      switch (key) {
        case "name":
          meta.name = cleanValue;
          break;
        case "description":
          // Handle multi-line description (>)
          meta.description = cleanValue.replace(/^>\s*/, "");
          break;
        case "version":
          meta.version = cleanValue;
          break;
        case "enabled":
          meta.enabled = cleanValue !== "false";
          break;
      }
    }

    // Parse requires block (simplified)
    const requiresMatch = frontmatter.match(/requires:\s*\n((?:\s+.+\n?)*)/);
    if (requiresMatch) {
      const block = requiresMatch[1];
      const envMatch = block.match(/env:\s*\[([^\]]*)\]/);
      const toolsMatch = block.match(/tools:\s*\[([^\]]*)\]/);

      if (envMatch) {
        meta.requires.env = envMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/["']/g, ""))
          .filter(Boolean);
      }
      if (toolsMatch) {
        meta.requires.tools = toolsMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/["']/g, ""))
          .filter(Boolean);
      }
    }

    return { meta, body };
  }

  /**
   * Check if a skill's requirements are met.
   */
  private checkRequirements(meta: SkillMeta): {
    available: boolean;
    reason?: string;
  } {
    // Check env vars
    for (const envVar of meta.requires.env) {
      if (!process.env[envVar]) {
        return {
          available: false,
          reason: `Missing env var: ${envVar}`,
        };
      }
    }

    return { available: true };
  }

  /**
   * Get all active skills (enabled + requirements met).
   */
  getActiveSkills(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.isAvailable);
  }

  /**
   * Get all skills regardless of status.
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get the full SKILL.md body for a skill (for prompt injection).
   */
  getSkillBody(name: string): string {
    const skill = this.skills.get(name);
    return skill ? skill.body : "";
  }

  /**
   * Enable or disable a skill by writing to its SKILL.md frontmatter.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    try {
      let content = fs.readFileSync(skill.skillFilePath, "utf-8");

      if (content.match(/^enabled:\s*.+$/m)) {
        content = content.replace(/^enabled:\s*.+$/m, `enabled: ${enabled}`);
      } else {
        // Add enabled field after the first ---
        content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
      }

      fs.writeFileSync(skill.skillFilePath, content, "utf-8");

      // Update in-memory state
      skill.meta.enabled = enabled;
      skill.isAvailable = enabled && !skill.unavailableReason;

      logger.info(`Skill "${name}" ${enabled ? "enabled" : "disabled"}`);
      return true;
    } catch (error) {
      logger.error(`Failed to toggle skill "${name}": ${error}`);
      return false;
    }
  }

  /**
   * Reload all skills from disk.
   */
  reload(): Skill[] {
    return this.discover();
  }
}

export const skillLoader = new SkillLoader();
