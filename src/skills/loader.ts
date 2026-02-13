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
  dirPath: string;
  skillFilePath: string;
  body: string;
  isAvailable: boolean;
  unavailableReason?: string;
}

// Resolved lazily inside discover() so process.cwd() is correct at call time
function getSkillsDir(): string {
  return path.join(process.cwd(), "workspace", "skills");
}

export class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  discover(): Skill[] {
    this.skills.clear();

    const SKILLS_DIR = getSkillsDir();

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

  private loadSkillFile(filePath: string, dirName: string): Skill | null {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { meta, body } = this.parseFrontmatter(raw, dirName);

    if (!meta.name || !meta.description) {
      logger.warn(`Skill "${dirName}" missing name or description, skipping`);
      return null;
    }

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

    if (!content.startsWith("---")) {
      return { meta: defaults, body: content };
    }

    const endIdx = content.indexOf("---", 3);
    if (endIdx === -1) {
      return { meta: defaults, body: content };
    }

    const frontmatter = content.substring(3, endIdx).trim();
    const body = content.substring(endIdx + 3).trim();

    const meta = { ...defaults };
    const lines = frontmatter.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (!match) continue;

      const [, key, value] = match;
      const cleanValue = value.replace(/^["']|["']$/g, "").trim();

      switch (key) {
        case "name":
          meta.name = cleanValue;
          break;
        case "description": {
          const isBlock = cleanValue === ">" || cleanValue === "|";
          if (isBlock) {
            const parts: string[] = [];
            while (i + 1 < lines.length && lines[i + 1].match(/^\s+\S/)) {
              parts.push(lines[++i].trim());
            }
            meta.description = parts.join(" ");
          } else {
            meta.description = cleanValue.replace(/^>\s*/, "");
          }
          break;
        }
        case "version":
          meta.version = cleanValue;
          break;
        case "enabled":
          meta.enabled = cleanValue !== "false";
          break;
      }
    }

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

  private checkRequirements(meta: SkillMeta): {
    available: boolean;
    reason?: string;
  } {
    for (const envVar of meta.requires.env) {
      if (!process.env[envVar]) {
        return { available: false, reason: `Missing env var: ${envVar}` };
      }
    }
    return { available: true };
  }

  getActiveSkills(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.isAvailable);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getSkillBody(name: string): string {
    const skill = this.skills.get(name);
    return skill ? skill.body : "";
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    try {
      let content = fs.readFileSync(skill.skillFilePath, "utf-8");

      if (content.match(/^enabled:\s*.+$/m)) {
        content = content.replace(/^enabled:\s*.+$/m, `enabled: ${enabled}`);
      } else {
        content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
      }

      fs.writeFileSync(skill.skillFilePath, content, "utf-8");

      skill.meta.enabled = enabled;
      skill.isAvailable = enabled && !skill.unavailableReason;

      logger.info(`Skill "${name}" ${enabled ? "enabled" : "disabled"}`);
      return true;
    } catch (error) {
      logger.error(`Failed to toggle skill "${name}": ${error}`);
      return false;
    }
  }

  reload(): Skill[] {
    return this.discover();
  }
}

export const skillLoader = new SkillLoader();
