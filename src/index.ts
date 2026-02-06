// src/index.ts

import * as dotenv from "dotenv";
import { ChannelGateway } from "./channels/gateway";
import { AgentOrchestrator } from "./agent/orchestrator";
import { NormalizedMessage } from "./channels/base";
import { logger } from "./utils/logger";
import { setGatewayForTools } from "./tools";
import { initializeDatabase } from "./db";

dotenv.config();

async function start() {
  logger.info("Initializing Noni with Multi-Channel Architecture...");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    logger.error("❌ Missing ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  // Initialize database (creates tables if not exist)
  initializeDatabase();

  const agent = new AgentOrchestrator(anthropicKey);

  // Initialize memory system (MEMORY.md, daily logs, search index)
  await agent.initializeMemory();

  const gateway = ChannelGateway.createFromConfig({
    telegram: {
      enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      allowFrom: process.env.TELEGRAM_ALLOW_FROM?.split(","),
      groups: {
        enabled: Boolean(process.env.TELEGRAM_GROUPS_ENABLED),
        requireMention: process.env.TELEGRAM_REQUIRE_MENTION === "true",
        allowList: process.env.TELEGRAM_GROUP_ALLOWLIST?.split(","),
      },
    },
    discord: {
      enabled: Boolean(process.env.DISCORD_BOT_TOKEN),
      token: process.env.DISCORD_BOT_TOKEN || "",
      allowFrom: process.env.DISCORD_ALLOW_FROM?.split(","),
      groups: {
        enabled: Boolean(process.env.DISCORD_GROUPS_ENABLED),
        requireMention: process.env.DISCORD_REQUIRE_MENTION === "true",
        allowList: process.env.DISCORD_GROUP_ALLOWLIST?.split(","),
      },
      guildAllowList: process.env.DISCORD_GUILD_ALLOWLIST?.split(","),
      dmPolicy: (process.env.DISCORD_DM_POLICY as any) || "pairing",
    },
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED === "true",
      allowFrom: process.env.WHATSAPP_ALLOW_FROM?.split(","),
      groups: {
        enabled: Boolean(process.env.WHATSAPP_GROUPS_ENABLED),
        requireMention: process.env.WHATSAPP_REQUIRE_MENTION === "true",
        allowList: process.env.WHATSAPP_GROUP_ALLOWLIST?.split(","),
      },
      authDir: process.env.WHATSAPP_AUTH_DIR,
      qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || "60"),
    },
  });

  agent.setGateway(gateway);
  setGatewayForTools(gateway);

  await gateway.initializeAll();

  const messageHandler = async (
    message: NormalizedMessage,
  ): Promise<string> => {
    logger.info(
      `[${message.channel}] Processing message from user ${message.userId}`,
    );

    try {
      await gateway.sendTyping(
        message.channel,
        message.userId,
        message.groupId,
      );

      const response = await agent.handleUserMessage(
        `${message.channel}:${message.userId}`,
        message.content,
        message.username,
      );

      return response;
    } catch (error) {
      logger.error(
        `Error processing message from ${message.channel}:${message.userId}`,
        error,
      );
      return "❌ Sorry, I encountered an error processing your message.";
    }
  };

  await gateway.startListening(messageHandler);

  logger.success(
    "✅ Noni is Online with Multi-Channel Support + Persistent Memory",
  );
  logger.info(
    `Active channels: ${gateway
      .getStatus()
      .map((s) => s.channel)
      .join(", ")}`,
  );

  const shutdown = async () => {
    logger.warn("Received shutdown signal. Closing channels...");
    agent.shutdown();
    await gateway.shutdownAll();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((err) => {
  logger.error("Fatal error during bot startup", err);
  process.exit(1);
});
