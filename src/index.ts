// src/index.ts

import * as dotenv from "dotenv";
dotenv.config();

import { setGatewayInstance } from "./tools/core/imageOps";
import { GatewayServer } from "./gateway/server";
import { ChannelAdapter } from "./gateway/channelAdapter";
import { AgentAdapter } from "./gateway/agentAdapter";
import { ChannelGateway } from "./channels/gateway";
import { AgentOrchestrator } from "./agent/orchestrator";
import { heartbeat } from "./agent/heartbeat";
import { NormalizedMessage } from "./channels/base";
import { logger } from "./utils/logger";
import { setGatewayForTools } from "./tools";
import { initializeDatabase } from "./db";
import { ApiServer } from "./api/server";
import { cronScheduler } from "./scheduler/cron";
import { eventTriggers } from "./scheduler/triggers";
import { CalendarTool } from "./tools/core/calendar";
import { loadAllTools } from "./tools/loader";

async function start() {
  logger.info("🚀 Starting Curie with Gateway Protocol...");

  // Validate that the configured LLM provider has its key set
  const provider = process.env.LLM_PROVIDER;
  if (!provider) {
    logger.error(
      "❌ Missing LLM_PROVIDER in .env (set to 'anthropic' or 'openai')",
    );
    process.exit(1);
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    logger.error("❌ LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    logger.error("❌ LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
    process.exit(1);
  }

  // Initialize database
  initializeDatabase();

  // ─── Step 0: Load all tools ──────────────────────────────────
  await loadAllTools();

  // ─── Step 1: Start Gateway Server ───────────────────────────
  const gatewayServer = new GatewayServer(18789);
  await gatewayServer.start();

  // ─── Step 2: Initialize Agent Orchestrator ──────────────────
  const agent = new AgentOrchestrator();
  await agent.initializeMemory();

  // ─── Step 3: Connect Agent to Gateway ───────────────────────
  const agentAdapter = new AgentAdapter(agent);
  await agentAdapter.connect();

  // ─── Step 4: Initialize Channels ────────────────────────────
  const channelGateway = ChannelGateway.createFromConfig({
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
      dmPolicy: (process.env.WHATSAPP_DM_POLICY as any) || "pairing",
      selfChatMode: process.env.WHATSAPP_SELF_CHAT === "true",
      sendReadReceipts: process.env.WHATSAPP_SEND_READ_RECEIPTS !== "false",
      debugIds: process.env.WHATSAPP_DEBUG_IDS === "true",
      testMode: process.env.WHATSAPP_TEST_MODE === "true",
      ackReaction: process.env.WHATSAPP_ACK_EMOJI
        ? {
            emoji: process.env.WHATSAPP_ACK_EMOJI,
            direct: process.env.WHATSAPP_ACK_DIRECT !== "false",
            group: (process.env.WHATSAPP_ACK_GROUP as any) || "mentions",
          }
        : undefined,
      groups: {
        enabled: Boolean(process.env.WHATSAPP_GROUPS_ENABLED),
        requireMention: process.env.WHATSAPP_REQUIRE_MENTION === "true",
        allowList: process.env.WHATSAPP_GROUP_ALLOWLIST?.split(","),
      },
      groupPolicy: (process.env.WHATSAPP_GROUP_POLICY as any) || undefined,
      groupAllowFrom: process.env.WHATSAPP_GROUP_ALLOW_FROM?.split(","),
      groupActivation:
        (process.env.WHATSAPP_GROUP_ACTIVATION as any) || undefined,
      authDir: process.env.WHATSAPP_AUTH_DIR,
      qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || "60"),
    },
  });

  agent.setGateway(channelGateway);
  setGatewayForTools(channelGateway);
  setGatewayInstance(channelGateway);

  // ─── Step 5: Connect Channels via Adapters ──────────────────
  const channelAdapters: ChannelAdapter[] = [];

  await channelGateway.initializeAll();

  for (const [name, channel] of channelGateway.getAdapters().entries()) {
    const adapter = new ChannelAdapter(channel, name);
    await adapter.connect();
    channelAdapters.push(adapter);
    logger.success(`📡 ${name} connected to gateway`);
  }

  // ─── Step 6: Setup Message Flow ─────────────────────────────
  const messageHandler = async (
    message: NormalizedMessage,
  ): Promise<string> => {
    logger.info(`[${message.channel}] Message from ${message.userId}`);

    const adapter = channelAdapters.find(
      (a) => (a as any).channelName === message.channel,
    );

    if (!adapter) {
      logger.error(`No adapter found for channel: ${message.channel}`);
      return "Channel not connected to gateway";
    }

    await adapter.handleChannelMessage(message);
    return "";
  };

  channelGateway.startListening(messageHandler);

  // ─── Step 7: Start Proactive Systems ────────────────────────
  logger.info("🔧 Starting proactive systems...");

  const apiServer = new ApiServer(agent);
  apiServer.setGateway(channelGateway);
  await apiServer.start();
  cronScheduler.setGateway(channelGateway);
  cronScheduler.setLlmHandler((userId, prompt, username) =>
    agent.handleUserMessage(userId, prompt, username),
  );
  cronScheduler.start();

  eventTriggers.setGateway(channelGateway);
  eventTriggers.setCalendar(new CalendarTool());
  eventTriggers.setLlmHandler((userId, prompt, username) =>
    agent.handleUserMessage(userId, prompt, username),
  );
  eventTriggers.configure({
    ownerUserId: process.env.OWNER_USER_ID || "whatsapp:owner",
    defaultChannel: "whatsapp",
  });
  eventTriggers.start();

  heartbeat.setGateway(channelGateway);
  heartbeat.start();

  // ─── Ready ───────────────────────────────────────────────────
  logger.success("✅ Curie Online");
  logger.info(`🤖 LLM: ${provider}/${process.env.LLM_MODEL || "default"}`);
  logger.info("📡 Gateway: ws://localhost:18789");
  logger.info("🌐 API: http://localhost:3000");

  // ─── Shutdown Handler ────────────────────────────────────────
  const shutdown = async () => {
    logger.warn("Shutting down...");

    for (const adapter of channelAdapters) adapter.disconnect();
    agentAdapter.disconnect();

    heartbeat.stop();
    cronScheduler.stop();
    eventTriggers.stop();
    agent.shutdown();
    apiServer.shutdown();

    await channelGateway.shutdownAll();
    await gatewayServer.stop();

    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});
