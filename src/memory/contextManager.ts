// src/memory/contextManager.ts

import * as fs from "fs";
import * as path from "path";
import { directory } from "./directory";
import { memoryFiles } from "./memoryFiles";
import { skillRegistry } from "../skills/registry";
import { logger } from "../utils/logger";

export class ContextManager {
  private workspaceDir = path.join(process.cwd(), "workspace");

  async assembleContext(userId?: string, username?: string): Promise<string> {
    let context = "";

    // 1. Core identity
    context += this.loadFile("SOUL.md");
    context += "\n\n";

    // 2. Workspace rules, memory discipline, skill authoring guidance
    context += this.loadFile("AGENTS.md");
    context += "\n\n";

    // 3. Current date — needed for daily log paths
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
    });
    context += `Current date: ${dateStr} | Local time: ${timeStr} (PST/PDT)\n\n`;

    // 4. Who is speaking + their profile and memory access
    if (userId) {
      const isOwner = directory.isOwner(userId);
      const identity = directory.resolveUserIdentity(userId, username);

      if (isOwner) {
        context += this.loadFile("USER.md");
        const ownerName = username || identity.split(" ")[0];
        context += `\n\nYou are currently speaking with your owner, ${ownerName}.\n\n`;

        const memoryContent = memoryFiles.read("MEMORY.md");
        if (memoryContent) {
          context += "## Long-Term Memory\n";
          context += memoryContent;
          context += "\n\n";
        }
      } else {
        context += `\n\nYou are currently speaking with: ${identity}\n`;
      }
    }

    // 5. Daily logs — today + yesterday for continuity
    const todayLog = memoryFiles.read(memoryFiles.todayLogPath());
    const yesterdayLog = memoryFiles.read(memoryFiles.yesterdayLogPath());

    if (todayLog || yesterdayLog) {
      context += "## Recent Daily Context\n";
      if (yesterdayLog) {
        context += `### Yesterday\n`;
        context += yesterdayLog;
        context += "\n\n";
      }
      if (todayLog) {
        context += `### Today\n`;
        context += todayLog;
        context += "\n\n";
      }
    }

    // 6. Skills — full body injected so LLM has exact filenames and args
    const skillsSummary = skillRegistry.buildSkillsSummary();
    if (skillsSummary) {
      context += skillsSummary;
      context += "\n\n";
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
