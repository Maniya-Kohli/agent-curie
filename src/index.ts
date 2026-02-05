import * as dotenv from "dotenv";
import { Telegraf } from "telegraf";
import { AgentOrchestrator } from "./agent/orchestrator";
import { memory } from "./agent/memory";
import { logger } from "./utils/logger";

dotenv.config();

async function start() {
  logger.info("Initializing Noni TS...");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!anthropicKey || !telegramToken) {
    logger.error("❌ Missing ANTHROPIC_API_KEY or TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }

  const noni = new AgentOrchestrator(anthropicKey);
  const bot = new Telegraf(telegramToken);

  // 1. Start Command - Matches Python welcome message
  bot.start((ctx) => {
    logger.info(
      `Start command triggered by ${ctx.from.first_name} (${ctx.from.id})`,
    );
    const welcome = `👋 Hello ${ctx.from.first_name}!

I'm an AI agent powered by Claude. I can help you with:

🌤️ **Weather** - "What's the weather in Tokyo?"
🔍 **Web Search** - "Search for latest AI news"
🧮 **Calculations** - "Calculate 15% tip on $87.50"
📁 **Files** - "Write a Python script to hello.py"

Available commands:
/start - Show this message
/clear - Clear conversation history
/stats - Show bot statistics`;
    return ctx.reply(welcome, { parse_mode: "Markdown" });
  });

  // 2. Clear Command - Matches Python clear_command
  bot.command("clear", async (ctx) => {
    const userId = ctx.from.id.toString();
    memory.clearConversation(userId);
    logger.warn(`Conversation history cleared for user: ${userId}`);
    await ctx.reply("✅ Conversation history cleared!");
  });

  // 3. Stats Command - Matches Python stats_command
  bot.command("stats", async (ctx) => {
    logger.info(`Stats requested by ${ctx.from.id}`);
    const stats = noni.getStats();
    const statsMessage = `📊 **Bot Statistics**

🤖 Model: ${stats.model}
👥 Total users: ${stats.totalUsers}
💬 Total messages: ${stats.totalMessages}`;
    await ctx.reply(statsMessage, { parse_mode: "Markdown" });
  });

  // 4. Main Message Handler
  bot.on("text", async (ctx) => {
    const userId = ctx.from.id.toString();
    const userMessage = ctx.message.text;

    logger.info(
      `Received message from ${ctx.from.first_name} (${userId}): ${userMessage.substring(0, 50)}...`,
    );

    try {
      await ctx.sendChatAction("typing");
      const response = await noni.handleUserMessage(userId, userMessage);

      // 5. Message Splitting - Matches Python logic
      if (response.length <= 4096) {
        await ctx.reply(response);
      } else {
        logger.info(
          `Response exceeds 4096 chars, splitting into chunks for ${userId}`,
        );
        const chunks = response.match(/.{1,4096}/g) || [];
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
      logger.success(`Successfully processed message for user ${userId}`);
    } catch (error) {
      logger.error(`Error handling message for ${userId}`, error);
      await ctx.reply(
        "❌ Sorry, I encountered an error processing your message.",
      );
    }
  });

  bot.launch();
  logger.success("✅ Noni is Online and logging to bot.log");

  process.once("SIGINT", () => {
    logger.warn("SIGINT received. Shutting down bot...");
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    logger.warn("SIGTERM received. Shutting down bot...");
    bot.stop("SIGTERM");
  });
}

start().catch((err) => {
  logger.error("Fatal error during bot startup", err);
  process.exit(1);
});
