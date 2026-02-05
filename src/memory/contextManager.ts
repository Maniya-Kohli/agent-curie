import * as fs from "fs/promises";
import path from "path";
import { db } from "../db";
import { facts } from "../db/schema";
import { desc } from "drizzle-orm";

export class ContextManager {
  private workspaceDir = path.join(process.cwd(), "workspace");

  /**
   * Assembles the multi-tier context for a conversation.
   * Tier 1: Identity Files (Who Noni/User are)
   * Tier 2: Relevant Facts from DB (What Noni knows)
   */
  async assembleContext(): Promise<string> {
    const soul = await fs.readFile(
      path.join(this.workspaceDir, "SOUL.md"),
      "utf-8",
    );
    const user = await fs.readFile(
      path.join(this.workspaceDir, "USER.md"),
      "utf-8",
    );

    // Fetch the 5 most relevant or recent facts
    const recentFacts = await db
      .select()
      .from(facts)
      .orderBy(desc(facts.lastReferenced))
      .limit(5);
    const factString = recentFacts.map((f) => `- ${f.content}`).join("\n");

    return `
    ${soul}
    
    ## USER PROFILE
    ${user}
    
    ## LEARNED FACTS
    ${factString}
    `;
  }
}
