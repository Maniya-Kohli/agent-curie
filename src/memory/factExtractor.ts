import { LLMInterface } from "../agent/llm";
import { db } from "../db";
import { facts } from "../db/schema";
import { v4 as uuidv4 } from "uuid";

export class FactExtractor {
  private llm: LLMInterface;

  constructor(llm: LLMInterface) {
    this.llm = llm;
  }

  /**
   * Analyzes conversation history to extract learnable facts.
   * Now correctly uses the 'complete' method from your LLMInterface.
   */
  async extractAndStoreFacts(userId: string, conversationHistory: any[]) {
    const prompt = `Review this conversation and extract new facts about the user. 
    Return ONLY a raw JSON array of objects with: "content", "category", and "confidence" (0-1).
    Categories: "personal", "preference", "project", "relationship".
    
    Conversation: ${JSON.stringify(conversationHistory)}`;

    try {
      const response = await this.llm.complete(
        [{ role: "user", content: prompt }],
        undefined, // No tools needed for memory extraction
        1024,
        0, // Low temperature for consistent JSON output
        "You are a memory extraction engine. Return strictly JSON.",
      );

      const text =
        response.content[0].type === "text" ? response.content[0].text : "[]";

      // Clean up potential markdown formatting from the LLM
      const cleanJson = text.replace(/```json|```/g, "").trim();
      const extractedFacts = JSON.parse(cleanJson);

      for (const fact of extractedFacts) {
        await db.insert(facts).values({
          id: uuidv4(),
          content: fact.content,
          category: fact.category,
          confidence: fact.confidence,
          sourceType: "explicit",
          lastReferenced: new Date(),
        });
      }

      console.log(
        `Successfully stored ${extractedFacts.length} new facts for user ${userId}.`,
      );
    } catch (error) {
      console.error("Fact Extraction failed:", error);
    }
  }
}
