// // src/index.ts

// import * as dotenv from "dotenv";
// dotenv.config();

// import { ChannelGateway } from "./channels/gateway";
// import { AgentOrchestrator } from "./agent/orchestrator";
// import { heartbeat } from "./agent/heartbeat";
// import { NormalizedMessage } from "./channels/base";
// import { logger } from "./utils/logger";
// import { setGatewayForTools } from "./tools";
// import { initializeDatabase } from "./db";
// import { ApiServer } from "./api/server";
// import { reminderManager } from "./scheduler/reminders";
// import { cronScheduler } from "./scheduler/cron";
// import { eventTriggers } from "./scheduler/triggers";
// import { CalendarTool } from "./tools/calendar";

// async function start() {
//   logger.info("Initializing Noni with Multi-Channel Architecture...");

//   const anthropicKey = process.env.ANTHROPIC_API_KEY;
//   if (!anthropicKey) {
//     logger.error("❌ Missing ANTHROPIC_API_KEY in .env");
//     process.exit(1);
//   }

//   // Initialize database
//   initializeDatabase();

//   const agent = new AgentOrchestrator(anthropicKey);

//   // Initialize memory system
//   await agent.initializeMemory();

//   const gateway = ChannelGateway.createFromConfig({
//     telegram: {
//       enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
//       botToken: process.env.TELEGRAM_BOT_TOKEN || "",
//       allowFrom: process.env.TELEGRAM_ALLOW_FROM?.split(","),
//       groups: {
//         enabled: Boolean(process.env.TELEGRAM_GROUPS_ENABLED),
//         requireMention: process.env.TELEGRAM_REQUIRE_MENTION === "true",
//         allowList: process.env.TELEGRAM_GROUP_ALLOWLIST?.split(","),
//       },
//     },
//     discord: {
//       enabled: Boolean(process.env.DISCORD_BOT_TOKEN),
//       token: process.env.DISCORD_BOT_TOKEN || "",
//       allowFrom: process.env.DISCORD_ALLOW_FROM?.split(","),
//       groups: {
//         enabled: Boolean(process.env.DISCORD_GROUPS_ENABLED),
//         requireMention: process.env.DISCORD_REQUIRE_MENTION === "true",
//         allowList: process.env.DISCORD_GROUP_ALLOWLIST?.split(","),
//       },
//       guildAllowList: process.env.DISCORD_GUILD_ALLOWLIST?.split(","),
//       dmPolicy: (process.env.DISCORD_DM_POLICY as any) || "pairing",
//     },
//     whatsapp: {
//       enabled: process.env.WHATSAPP_ENABLED === "true",
//       allowFrom: process.env.WHATSAPP_ALLOW_FROM?.split(","),
//       dmPolicy: (process.env.WHATSAPP_DM_POLICY as any) || "pairing",
//       selfChatMode: process.env.WHATSAPP_SELF_CHAT === "true",
//       sendReadReceipts: process.env.WHATSAPP_SEND_READ_RECEIPTS !== "false",
//       debugIds: process.env.WHATSAPP_DEBUG_IDS === "true",
//       testMode: process.env.WHATSAPP_TEST_MODE === "true",
//       ackReaction: process.env.WHATSAPP_ACK_EMOJI
//         ? {
//             emoji: process.env.WHATSAPP_ACK_EMOJI,
//             direct: process.env.WHATSAPP_ACK_DIRECT !== "false",
//             group: (process.env.WHATSAPP_ACK_GROUP as any) || "mentions",
//           }
//         : undefined,
//       groups: {
//         enabled: Boolean(process.env.WHATSAPP_GROUPS_ENABLED),
//         requireMention: process.env.WHATSAPP_REQUIRE_MENTION === "true",
//         allowList: process.env.WHATSAPP_GROUP_ALLOWLIST?.split(","),
//       },
//       groupPolicy: (process.env.WHATSAPP_GROUP_POLICY as any) || undefined,
//       groupAllowFrom: process.env.WHATSAPP_GROUP_ALLOW_FROM?.split(","),
//       groupActivation:
//         (process.env.WHATSAPP_GROUP_ACTIVATION as any) || undefined,
//       authDir: process.env.WHATSAPP_AUTH_DIR,
//       qrTimeout: parseInt(process.env.WHATSAPP_QR_TIMEOUT || "60"),
//     },
//   });

//   agent.setGateway(gateway);
//   setGatewayForTools(gateway);

//   // Start WebChat API server
//   const apiServer = new ApiServer(agent);
//   apiServer.setGateway(gateway);
//   await apiServer.start();

//   // Initialize channels BEFORE proactive systems
//   await gateway.initializeAll();

//   const messageHandler = async (
//     message: NormalizedMessage,
//   ): Promise<string> => {
//     logger.info(
//       `[${message.channel}] Processing message from user ${message.userId}`,
//     );

//     try {
//       await gateway.sendTyping(
//         message.channel,
//         message.userId,
//         message.groupId,
//       );

//       const response = await agent.handleUserMessage(
//         `${message.channel}:${message.userId}`,
//         message.content,
//         message.username,
//       );

//       return response;
//     } catch (error) {
//       logger.error(
//         `Error processing message from ${message.channel}:${message.userId}`,
//         error,
//       );
//       return "❌ Sorry, I encountered an error processing your message.";
//     }
//   };

//   gateway.startListening(messageHandler);

//   logger.info("🔧 Starting proactive systems...");

//   // 1. Reminder delivery engine
//   try {
//     logger.info("📋 Initializing reminder delivery engine...");
//     reminderManager.setGateway(gateway);
//     reminderManager.start();
//     logger.success("✅ Reminder delivery engine started");
//   } catch (error: any) {
//     logger.error("❌ Failed to start reminder delivery engine:", error);
//   }

//   // 2. Cron scheduler
//   try {
//     logger.info("⏰ Initializing cron scheduler...");
//     cronScheduler.setGateway(gateway);
//     cronScheduler.setLlmHandler((userId, prompt, username) =>
//       agent.handleUserMessage(userId, prompt, username),
//     );
//     cronScheduler.start();
//     logger.success("✅ Cron scheduler started");
//   } catch (error: any) {
//     logger.error("❌ Failed to start cron scheduler:", error);
//   }

//   // 3. Event triggers
//   try {
//     logger.info("📅 Initializing event triggers...");
//     eventTriggers.setGateway(gateway);
//     eventTriggers.setCalendar(new CalendarTool());
//     eventTriggers.setLlmHandler((userId, prompt, username) =>
//       agent.handleUserMessage(userId, prompt, username),
//     );
//     eventTriggers.configure({
//       ownerUserId: process.env.OWNER_USER_ID || "whatsapp:owner",
//       defaultChannel: "whatsapp",
//     });
//     eventTriggers.start();
//     logger.success("✅ Event triggers started");
//   } catch (error: any) {
//     logger.error("❌ Failed to start event triggers:", error);
//   }

//   // 4. Heartbeat service
//   try {
//     logger.info("💓 Initializing heartbeat service...");
//     heartbeat.setGateway(gateway);
//     heartbeat.start();
//     logger.success("✅ Heartbeat service started");
//   } catch (error: any) {
//     logger.error("❌ Failed to start heartbeat service:", error);
//   }

//   logger.success(
//     "✅ Noni is Online with Multi-Channel Support + Persistent Memory + Proactive Engine + Heartbeat",
//   );

//   const shutdown = async () => {
//     logger.warn("Received shutdown signal. Closing channels...");
//     heartbeat.stop();
//     reminderManager.stop();
//     cronScheduler.stop();
//     eventTriggers.stop();
//     agent.shutdown();
//     apiServer.shutdown();
//     await gateway.shutdownAll();
//     process.exit(0);
//   };

//   process.once("SIGINT", shutdown);
//   process.once("SIGTERM", shutdown);
// }

// start().catch((err) => {
//   logger.error("Fatal error during bot startup", err);
//   process.exit(1);
// });

// src/index.ts - GATEWAY MODE

import * as dotenv from "dotenv";
dotenv.config();

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
import { reminderManager } from "./scheduler/reminders";
import { cronScheduler } from "./scheduler/cron";
import { eventTriggers } from "./scheduler/triggers";
import { CalendarTool } from "./tools/calendar";

async function start() {
  logger.info("🚀 Starting Noni with Gateway Protocol...");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    logger.error("❌ Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  // Initialize database
  initializeDatabase();

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Start Gateway Server (central hub)
  // ═══════════════════════════════════════════════════════════════

  const gatewayServer = new GatewayServer(18789);
  await gatewayServer.start();

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Initialize Agent Orchestrator
  // ═══════════════════════════════════════════════════════════════

  const agent = new AgentOrchestrator(anthropicKey);
  await agent.initializeMemory();

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Connect Agent to Gateway
  // ═══════════════════════════════════════════════════════════════

  const agentAdapter = new AgentAdapter(agent);
  await agentAdapter.connect();

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Initialize Channels
  // ═══════════════════════════════════════════════════════════════

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

  // For backward compatibility with tools
  agent.setGateway(channelGateway);
  setGatewayForTools(channelGateway);

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Connect Channels to Gateway via Adapters
  // ═══════════════════════════════════════════════════════════════

  const channelAdapters: ChannelAdapter[] = [];

  // Initialize channels first
  await channelGateway.initializeAll();

  // Connect each channel to gateway
  for (const [name, channel] of channelGateway.getAdapters().entries()) {
    const adapter = new ChannelAdapter(channel, name);
    await adapter.connect();
    channelAdapters.push(adapter);

    logger.success(`📡 ${name} connected to gateway`);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: Setup Message Flow
  // ═══════════════════════════════════════════════════════════════

  const messageHandler = async (
    message: NormalizedMessage,
  ): Promise<string> => {
    logger.info(`[${message.channel}] Message from ${message.userId}`);

    // Find the adapter for this channel
    const adapter = channelAdapters.find(
      (a) => (a as any).channelName === message.channel,
    );

    if (!adapter) {
      logger.error(`No adapter found for channel: ${message.channel}`);
      return "Channel not connected to gateway";
    }

    // Forward to gateway (adapter handles the protocol)
    await adapter.handleChannelMessage(message);

    // Response will come back async through gateway
    return ""; // Don't need to return here, gateway handles delivery
  };

  channelGateway.startListening(messageHandler);

  // ═══════════════════════════════════════════════════════════════
  // STEP 7: Start Proactive Systems
  // ═══════════════════════════════════════════════════════════════

  logger.info("🔧 Starting proactive systems...");

  // API Server
  const apiServer = new ApiServer(agent);
  apiServer.setGateway(channelGateway);
  await apiServer.start();

  // Reminders
  reminderManager.setGateway(channelGateway);
  reminderManager.start();

  // Cron
  cronScheduler.setGateway(channelGateway);
  cronScheduler.setLlmHandler((userId, prompt, username) =>
    agent.handleUserMessage(userId, prompt, username),
  );
  cronScheduler.start();

  // Event triggers
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

  // Heartbeat
  heartbeat.setGateway(channelGateway);
  heartbeat.start();

  // ═══════════════════════════════════════════════════════════════
  // READY
  // ═══════════════════════════════════════════════════════════════

  logger.success("✅ Noni Online with Gateway Protocol");
  logger.info("📡 Gateway: ws://localhost:18789");
  logger.info("🌐 API: http://localhost:3000");
  logger.info("💬 Channels: Connected via adapters");

  // ═══════════════════════════════════════════════════════════════
  // Shutdown Handler
  // ═══════════════════════════════════════════════════════════════

  const shutdown = async () => {
    logger.warn("Shutting down...");

    // Disconnect adapters
    for (const adapter of channelAdapters) {
      adapter.disconnect();
    }
    agentAdapter.disconnect();

    // Stop services
    heartbeat.stop();
    reminderManager.stop();
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
