// // src/index.ts

// import * as dotenv from "dotenv";
// import { ChannelGateway } from "./channels/gateway";
// import { AgentOrchestrator } from "./agent/orchestrator";
// import { NormalizedMessage } from "./channels/base";
// import { logger } from "./utils/logger";
// import { setGatewayForTools } from "./tools";
// import { initializeDatabase } from "./db";
// import { ApiServer } from "./api/server";
// import { reminderManager } from "./scheduler/reminders";
// import { cronScheduler } from "./scheduler/cron";
// import { eventTriggers } from "./scheduler/triggers";
// import { CalendarTool } from "./tools/calendar";

// dotenv.config();

// async function start() {
//   logger.info("Initializing Noni with Multi-Channel Architecture...");

//   const anthropicKey = process.env.ANTHROPIC_API_KEY;
//   if (!anthropicKey) {
//     logger.error("âŒ Missing ANTHROPIC_API_KEY in .env");
//     process.exit(1);
//   }

//   // Initialize database (creates tables if not exist)
//   initializeDatabase();

//   const agent = new AgentOrchestrator(anthropicKey);

//   // Initialize memory system (MEMORY.md, daily logs, search index)
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
//       groups: {
//         enabled: Boolean(process.env.WHATSAPP_GROUPS_ENABLED),
//         requireMention: process.env.WHATSAPP_REQUIRE_MENTION === "true",
//         allowList: process.env.WHATSAPP_GROUP_ALLOWLIST?.split(","),
//       },
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

//   // âš ï¸ IMPORTANT: Initialize channels BEFORE starting proactive systems
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
//       return "âŒ Sorry, I encountered an error processing your message.";
//     }
//   };

//   gateway.startListening(messageHandler);

//   // â”€â”€â”€ Start Proactive Systems â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//   // âš ï¸ CRITICAL: These must start AFTER gateway.initializeAll() and gateway.startListening()
//   logger.info("ðŸ”§ Starting proactive systems...");

//   // 1. Reminder delivery engine
//   try {
//     logger.info("ðŸ“‹ Initializing reminder delivery engine...");
//     reminderManager.setGateway(gateway);
//     reminderManager.start();
//     logger.success("âœ… Reminder delivery engine started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start reminder delivery engine:", error);
//   }

//   // 2. Cron scheduler
//   try {
//     logger.info("â° Initializing cron scheduler...");
//     cronScheduler.setGateway(gateway);
//     cronScheduler.setLlmHandler((userId, prompt, username) =>
//       agent.handleUserMessage(userId, prompt, username),
//     );
//     cronScheduler.start();
//     logger.success("âœ… Cron scheduler started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start cron scheduler:", error);
//   }

//   // 3. Event triggers (calendar heads-up, etc.)
//   try {
//     logger.info("ðŸ“… Initializing event triggers...");
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
//     logger.success("âœ… Event triggers started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start event triggers:", error);
//   }

//   logger.success(
//     "âœ… Noni is Online with Multi-Channel Support + Persistent Memory + Proactive Engine",
//   );

//   const shutdown = async () => {
//     logger.warn("Received shutdown signal. Closing channels...");
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

// src/index.ts

// src/index.ts

// src/index.ts

// // src/index.ts

// import * as dotenv from "dotenv";
// import { ChannelGateway } from "./channels/gateway";
// import { AgentOrchestrator } from "./agent/orchestrator";
// import { NormalizedMessage } from "./channels/base";
// import { logger } from "./utils/logger";
// import { setGatewayForTools } from "./tools";
// import { initializeDatabase } from "./db";
// import { ApiServer } from "./api/server";
// import { reminderManager } from "./scheduler/reminders";
// import { cronScheduler } from "./scheduler/cron";
// import { eventTriggers } from "./scheduler/triggers";
// import { CalendarTool } from "./tools/calendar";

// dotenv.config();

// async function start() {
//   logger.info("Initializing Noni with Multi-Channel Architecture...");

//   const anthropicKey = process.env.ANTHROPIC_API_KEY;
//   if (!anthropicKey) {
//     logger.error("âŒ Missing ANTHROPIC_API_KEY in .env");
//     process.exit(1);
//   }

//   // Initialize database (creates tables if not exist)
//   initializeDatabase();

//   const agent = new AgentOrchestrator(anthropicKey);

//   // Initialize memory system (MEMORY.md, daily logs, search index)
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
//       groups: {
//         enabled: Boolean(process.env.WHATSAPP_GROUPS_ENABLED),
//         requireMention: process.env.WHATSAPP_REQUIRE_MENTION === "true",
//         allowList: process.env.WHATSAPP_GROUP_ALLOWLIST?.split(","),
//       },
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

//   // âš ï¸ IMPORTANT: Initialize channels BEFORE starting proactive systems
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
//       return "âŒ Sorry, I encountered an error processing your message.";
//     }
//   };

//   gateway.startListening(messageHandler);

//   // â”€â”€â”€ Start Proactive Systems â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//   // âš ï¸ CRITICAL: These must start AFTER gateway.initializeAll() and gateway.startListening()
//   logger.info("ðŸ”§ Starting proactive systems...");

//   // 1. Reminder delivery engine
//   try {
//     logger.info("ðŸ“‹ Initializing reminder delivery engine...");
//     reminderManager.setGateway(gateway);
//     reminderManager.start();
//     logger.success("âœ… Reminder delivery engine started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start reminder delivery engine:", error);
//   }

//   // 2. Cron scheduler
//   try {
//     logger.info("â° Initializing cron scheduler...");
//     cronScheduler.setGateway(gateway);
//     cronScheduler.setLlmHandler((userId, prompt, username) =>
//       agent.handleUserMessage(userId, prompt, username),
//     );
//     cronScheduler.start();
//     logger.success("âœ… Cron scheduler started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start cron scheduler:", error);
//   }

//   // 3. Event triggers (calendar heads-up, etc.)
//   try {
//     logger.info("ðŸ“… Initializing event triggers...");
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
//     logger.success("âœ… Event triggers started");
//   } catch (error: any) {
//     logger.error("âŒ Failed to start event triggers:", error);
//   }

//   logger.success(
//     "âœ… Noni is Online with Multi-Channel Support + Persistent Memory + Proactive Engine",
//   );

//   const shutdown = async () => {
//     logger.warn("Received shutdown signal. Closing channels...");
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

// src/index.ts

// src/index.ts

// src/index.ts

import * as dotenv from "dotenv";
import { ChannelGateway } from "./channels/gateway";
import { AgentOrchestrator } from "./agent/orchestrator";
import { NormalizedMessage } from "./channels/base";
import { logger } from "./utils/logger";
import { setGatewayForTools } from "./tools";
import { initializeDatabase } from "./db";
import { ApiServer } from "./api/server";
import { reminderManager } from "./scheduler/reminders";
import { cronScheduler } from "./scheduler/cron";
import { eventTriggers } from "./scheduler/triggers";
import { CalendarTool } from "./tools/calendar";

dotenv.config();

async function start() {
  logger.info("Initializing Noni with Multi-Channel Architecture...");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    logger.error("âŒ Missing ANTHROPIC_API_KEY in .env");
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
      dmPolicy: (process.env.WHATSAPP_DM_POLICY as any) || "pairing",
      selfChatMode: process.env.WHATSAPP_SELF_CHAT === "true",
      sendReadReceipts: process.env.WHATSAPP_SEND_READ_RECEIPTS !== "false",
      debugIds: process.env.WHATSAPP_DEBUG_IDS === "true",
      testMode: process.env.WHATSAPP_TEST_MODE === "true", // ⭐ NEW: Enable test mode
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

  agent.setGateway(gateway);
  setGatewayForTools(gateway);

  // Start WebChat API server
  const apiServer = new ApiServer(agent);
  apiServer.setGateway(gateway);
  await apiServer.start();

  // âš ï¸ IMPORTANT: Initialize channels BEFORE starting proactive systems
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
      return "âŒ Sorry, I encountered an error processing your message.";
    }
  };

  gateway.startListening(messageHandler);

  logger.info("ðŸ”§ Starting proactive systems...");

  // 1. Reminder delivery engine
  try {
    logger.info("ðŸ“‹ Initializing reminder delivery engine...");
    reminderManager.setGateway(gateway);
    reminderManager.start();
    logger.success("âœ… Reminder delivery engine started");
  } catch (error: any) {
    logger.error("âŒ Failed to start reminder delivery engine:", error);
  }

  // 2. Cron scheduler
  try {
    logger.info("â° Initializing cron scheduler...");
    cronScheduler.setGateway(gateway);
    cronScheduler.setLlmHandler((userId, prompt, username) =>
      agent.handleUserMessage(userId, prompt, username),
    );
    cronScheduler.start();
    logger.success("âœ… Cron scheduler started");
  } catch (error: any) {
    logger.error("âŒ Failed to start cron scheduler:", error);
  }

  // 3. Event triggers (calendar heads-up, etc.)
  try {
    logger.info("ðŸ“… Initializing event triggers...");
    eventTriggers.setGateway(gateway);
    eventTriggers.setCalendar(new CalendarTool());
    eventTriggers.setLlmHandler((userId, prompt, username) =>
      agent.handleUserMessage(userId, prompt, username),
    );
    eventTriggers.configure({
      ownerUserId: process.env.OWNER_USER_ID || "whatsapp:owner",
      defaultChannel: "whatsapp",
    });
    eventTriggers.start();
    logger.success("âœ… Event triggers started");
  } catch (error: any) {
    logger.error("âŒ Failed to start event triggers:", error);
  }

  logger.success(
    "âœ… Noni is Online with Multi-Channel Support + Persistent Memory + Proactive Engine",
  );

  const shutdown = async () => {
    logger.warn("Received shutdown signal. Closing channels...");
    reminderManager.stop();
    cronScheduler.stop();
    eventTriggers.stop();
    agent.shutdown();
    apiServer.shutdown();
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
