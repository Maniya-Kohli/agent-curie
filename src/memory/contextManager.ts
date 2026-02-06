// src/memory/contextManager.ts

import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { facts } from "../db/schema";
import { desc } from "drizzle-orm";
import { directory } from "./directory";

export class ContextManager {
  private workspaceDir = path.join(process.cwd(), "workspace");

  async assembleContext(userId?: string, username?: string): Promise<string> {
    let context = "";

    // 1. Load Agent Identity (SOUL.md - who the agent is)
    context += await this.loadFile("SOUL.md");
    context += "\n\n";

    // 2. Load Tools documentation
    context += await this.loadFile("TOOLS.md");
    context += "\n\n";

    // 3. Identify who is speaking
    if (userId) {
      const isOwner = directory.isOwner(userId);
      const identity = directory.resolveUserIdentity(userId, username);

      if (isOwner) {
        // This is you - load your personal context
        context += await this.loadFile("USER.md");
        context +=
          "\n\nYou are currently speaking with Maniya (your owner).\n\n";
      } else {
        // This is someone else
        context += `\n\nYou are currently speaking with: ${identity}\n`;
        context += `This is NOT your owner. Respond professionally and helpfully.\n\n`;
      }
    }

    // 4. Load recent relevant facts from database
    try {
      const recentFacts = await db
        .select()
        .from(facts)
        .orderBy(desc(facts.validFrom))
        .limit(5);

      if (recentFacts.length > 0) {
        context += "## Recent Memories:\n";
        recentFacts.forEach((fact) => {
          context += `- ${fact.content}\n`;
        });
        context += "\n";
      }
    } catch (error) {
      console.warn("Could not load facts from database:", error);
    }

    return context;
  }

  private async loadFile(filename: string): Promise<string> {
    const filePath = path.join(this.workspaceDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch (error) {
      console.warn(`Could not load ${filename}:`, error);
    }
    return "";
  }
}
