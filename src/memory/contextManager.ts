// src/memory/contextManager.ts

import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { facts } from "../db/schema";
import { desc } from "drizzle-orm";
import { directory } from "./directory";
import { memoryFiles } from "./memoryFiles";
import { skillRegistry } from "../skills/registry";
import { logger } from "../utils/logger";

export class ContextManager {
  private workspaceDir = path.join(process.cwd(), "workspace");

  async assembleContext(userId?: string, username?: string): Promise<string> {
    let context = "";

    // 1. Agent Identity (SOUL.md — persona + memory instructions)
    context += this.loadFile("SOUL.md");
    context += "\n\n";

    // 2. Tools documentation
    context += this.loadFile("TOOLS.md");
    context += "\n\n";

    // 3. Identify who is speaking
    if (userId) {
      const isOwner = directory.isOwner(userId);
      const identity = directory.resolveUserIdentity(userId, username);

      if (isOwner) {
        // Load full user profile (static + dynamic sections)
        context += this.loadFile("USER.md");
        context +=
          "\n\nYou are currently speaking with Maniya (your owner).\n\n";

        // 4. Long-term memory — ONLY for owner/private sessions
        const memoryContent = memoryFiles.read("MEMORY.md");
        if (memoryContent) {
          context += "## Long-Term Memory\n";
          context += memoryContent;
          context += "\n\n";
        }
      } else {
        context += `\n\nYou are currently speaking with: ${identity}\n`;
        context += `This is NOT your owner. Respond professionally and helpfully.\n`;
        context += `Do NOT load or share personal memories with non-owner users.\n\n`;
      }
    }

    // 5. Daily logs — today + yesterday (always loaded for continuity)
    const todayLog = memoryFiles.read(memoryFiles.todayLogPath());
    const yesterdayLog = memoryFiles.read(memoryFiles.yesterdayLogPath());

    if (todayLog || yesterdayLog) {
      context += "## Recent Daily Context\n";
      if (yesterdayLog) {
        context += `### Yesterday (${memoryFiles.yesterdayLogPath()})\n`;
        context += yesterdayLog;
        context += "\n\n";
      }
      if (todayLog) {
        context += `### Today (${memoryFiles.todayLogPath()})\n`;
        context += todayLog;
        context += "\n\n";
      }
    }

    // 6. Skills summary — compact list of active skills
    const skillsSummary = skillRegistry.buildSkillsSummary();
    if (skillsSummary) {
      context += skillsSummary;
      context += "\n\n";
    }

    // 7. Legacy facts (backward compat)
    try {
      const recentFacts = await db
        .select()
        .from(facts)
        .orderBy(desc(facts.validFrom))
        .limit(5);

      if (recentFacts.length > 0) {
        context += "## Legacy Memories (from database):\n";
        recentFacts.forEach((fact) => {
          context += `- ${fact.content}\n`;
        });
        context += "\n";
      }
    } catch (error) {
      // Silently skip if facts table has issues
    }

    return context;
  }

  private loadFile(filename: string): string {
    const filePath = path.join(this.workspaceDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch (error) {
      logger.warn(`Could not load ${filename}: ${error}`);
    }
    return "";
  }
}
