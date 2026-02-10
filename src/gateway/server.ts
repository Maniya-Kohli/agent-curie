// src/gateway/server.ts

import WebSocket from "ws";
import { createServer } from "http";
import { SessionManager } from "./sessionManager";
import {
  GatewayMessage,
  ClientInfo,
  validateMessage,
  createError,
  createAck,
  AgentMessageMessage,
  ChannelSendMessage,
  parseUserId,
} from "./protocol";
import { logger } from "../utils/logger";

/**
 * Gateway WebSocket Server
 * Central hub for all client connections and message routing
 */
export class GatewayServer {
  private wss: WebSocket.Server;
  private httpServer: ReturnType<typeof createServer>;
  private clients = new Map<string, GatewayClient>();
  private sessionManager = new SessionManager();

  constructor(private port: number = 18789) {
    // Create HTTP server for WebSocket upgrade
    this.httpServer = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getHealthStatus()));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Create WebSocket server
    this.wss = new WebSocket.Server({ server: this.httpServer });

    this.setupWebSocketHandlers();
  }

  /**
   * Start the gateway server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        logger.success(
          `🌐 Gateway server started on ws://localhost:${this.port}`,
        );
        resolve();
      });
    });
  }

  /**
   * Stop the gateway server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients.values()) {
        client.ws.close();
      }

      this.wss.close(() => {
        this.httpServer.close(() => {
          logger.info("Gateway server stopped");
          resolve();
        });
      });
    });
  }

  /**
   * Setup WebSocket connection handlers
   */
  private setupWebSocketHandlers(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      const clientId = this.generateClientId();
      const client = new GatewayClient(clientId, ws);

      logger.info(`Client connected: ${clientId}`);

      ws.on("message", (data: WebSocket.Data) => {
        this.handleMessage(client, data);
      });

      ws.on("close", () => {
        this.handleClientDisconnect(client);
      });

      ws.on("error", (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error);
      });

      // Store client (but not registered yet)
      this.clients.set(clientId, client);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: GatewayClient, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      if (!validateMessage(message)) {
        client.sendError("INVALID_MESSAGE", "Invalid message format");
        return;
      }

      logger.info(`📨 ${client.id} → ${message.type}`);

      // Route message based on type
      switch (message.type) {
        case "client.register":
          this.handleClientRegister(client, message.clientInfo);
          break;

        case "client.heartbeat":
          client.lastHeartbeat = Date.now();
          break;

        case "agent.message":
          this.handleAgentMessage(message);
          break;

        case "agent.response":
          this.handleAgentResponse(message);
          break;

        case "channel.send":
          this.handleChannelSend(message);
          break;

        case "agent.typing":
          this.handleAgentTyping(message);
          break;

        case "session.create":
          this.handleSessionCreate(message);
          break;

        case "session.list":
          this.handleSessionList(client, message);
          break;

        case "session.get":
          this.handleSessionGet(client, message);
          break;

        case "tool.invoke":
          this.handleToolInvoke(message);
          break;

        case "tool.result":
          this.handleToolResult(message);
          break;

        default:
          logger.warn(`Unknown message type: ${(message as any).type}`);
          client.sendError(
            "UNKNOWN_MESSAGE_TYPE",
            `Unknown type: ${(message as any).type}`,
          );
      }
    } catch (error: any) {
      logger.error("Error handling message:", error);
      client.sendError("PROCESSING_ERROR", error.message);
    }
  }

  /**
   * Handle client registration
   */
  private handleClientRegister(client: GatewayClient, info: ClientInfo): void {
    client.info = info;
    client.registered = true;

    logger.success(`✅ Client registered: ${info.name} (${info.type})`);

    client.send({
      type: "ack",
      requestId: client.id,
      success: true,
      data: { clientId: client.id },
    });
  }

  /**
   * Handle client disconnect
   */
  private handleClientDisconnect(client: GatewayClient): void {
    logger.info(
      `Client disconnected: ${client.id} (${client.info?.name || "unregistered"})`,
    );
    this.clients.delete(client.id);
  }

  /**
   * Handle agent.message - route to agent
   */
  //   private handleAgentMessage(message: AgentMessageMessage): void {
  //     // Find agent client
  //     const agentClient = this.findClientByType("agent");
  //     if (!agentClient) {
  //       logger.error("No agent client connected");
  //       return;
  //     }

  //     // Get or create session
  //     const { channel, id: userId } = parseUserId(message.from);
  //     const session = this.sessionManager.getOrCreateSession(userId, channel);

  //     // Forward to agent with session context
  //     agentClient.send({
  //       ...message,
  //       sessionId: session.id,
  //     });
  //   }
  private handleAgentMessage(message: AgentMessageMessage): void {
    // Find agent client
    const agentClient = this.findClientByType("agent");
    if (!agentClient) {
      logger.error("No agent client connected");
      return;
    }

    // Get or create session
    const { channel, id: userId } = parseUserId(message.from);
    const session = this.sessionManager.getOrCreateSession(
      userId,
      channel,
      message.metadata?.groupId,
    );

    // Store the original metadata (including remoteJid for WhatsApp)
    if (message.metadata) {
      session.metadata = {
        ...session.metadata,
        ...message.metadata,
      };
    }

    // Forward to agent with session context
    agentClient.send({
      ...message,
      sessionId: session.id,
    });
  }

  /**
   * Handle agent.typing - route typing indicator to channel
   */
  private handleAgentTyping(message: any): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.error(`Session not found for typing: ${message.sessionId}`);
      return;
    }

    // Route to appropriate channel
    const channelClient = this.findClientByName(`channel-${session.channel}`);
    if (!channelClient) {
      logger.error(`Channel client not found: ${session.channel}`);
      return;
    }

    // Send typing indicator to channel
    const { id: userId } = parseUserId(session.userId);
    channelClient.send({
      type: "channel.typing",
      channel: session.channel!,
      userId: userId,
      groupId: session.groupId,
      isTyping: message.isTyping,
    });
  }

  /**
   * Handle agent.response - route back to channel
   */

  /**
   * Handle agent.response - route back to channel
   */
  private handleAgentResponse(message: any): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.error(`Session not found: ${message.sessionId}`);
      return;
    }

    const channelClient = this.findClientByName(`channel-${session.channel}`);
    if (!channelClient) {
      logger.error(`Channel client not found: ${session.channel}`);
      return;
    }

    // ✅ For WhatsApp, use remoteJid to send back to the correct chat
    let targetUserId: string;

    if (session.metadata?.remoteJid) {
      // Use the remoteJid - this is the chat we should reply to
      targetUserId = session.metadata.remoteJid;
    } else {
      // Fallback for other channels
      const { id } = parseUserId(session.userId);
      targetUserId = id;
    }

    channelClient.send({
      type: "channel.send",
      channel: session.channel!,
      userId: targetUserId, // ✅ This will now be 919821496560@s.whatsapp.net
      content: message.content,
      groupId: session.groupId,
    } as ChannelSendMessage);
  }

  //   private handleAgentResponse(message: any): void {
  //     const session = this.sessionManager.getSession(message.sessionId);
  //     if (!session) {
  //       logger.error(`Session not found: ${message.sessionId}`);
  //       return;
  //     }

  //     // Route to appropriate channel
  //     const channelClient = this.findClientByName(`channel-${session.channel}`);
  //     if (!channelClient) {
  //       logger.error(`Channel client not found: ${session.channel}`);
  //       return;
  //     }

  //     // Send to channel for delivery
  //     const { id: userId } = parseUserId(session.userId);
  //     channelClient.send({
  //       type: "channel.send",
  //       channel: session.channel!,
  //       userId: userId,
  //       content: message.content,
  //       groupId: session.groupId,
  //     } as ChannelSendMessage);
  //   }

  /**
   * Handle channel.send - forward to channel
   */
  private handleChannelSend(message: ChannelSendMessage): void {
    const channelClient = this.findClientByName(`channel-${message.channel}`);
    if (!channelClient) {
      logger.error(`Channel client not found: ${message.channel}`);
      return;
    }

    channelClient.send(message);
  }

  /**
   * Handle session.create
   */
  private handleSessionCreate(message: any): void {
    // Session creation is typically automatic, but can be explicit
    logger.info("Explicit session creation requested");
  }

  /**
   * Handle session.list
   */
  private handleSessionList(client: GatewayClient, message: any): void {
    const sessions = this.sessionManager.listSessions(message.filter);
    client.send(createAck(client.id, true, { sessions }));
  }

  /**
   * Handle session.get
   */
  private handleSessionGet(client: GatewayClient, message: any): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      client.sendError(
        "SESSION_NOT_FOUND",
        `Session ${message.sessionId} not found`,
      );
      return;
    }
    client.send(createAck(client.id, true, { session }));
  }

  /**
   * Handle tool.invoke - route to tool provider
   */
  private handleToolInvoke(message: any): void {
    // Find appropriate tool client
    const toolClient = this.findClientByType("tool");
    if (!toolClient) {
      logger.error("No tool client connected");
      return;
    }

    toolClient.send(message);
  }

  /**
   * Handle tool.result - route back to agent
   */
  private handleToolResult(message: any): void {
    const agentClient = this.findClientByType("agent");
    if (!agentClient) {
      logger.error("No agent client to receive tool result");
      return;
    }

    agentClient.send(message);
  }

  /**
   * Find client by type
   */
  private findClientByType(type: string): GatewayClient | undefined {
    for (const client of this.clients.values()) {
      if (client.info?.type === type && client.registered) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Find client by name
   */
  private findClientByName(name: string): GatewayClient | undefined {
    for (const client of this.clients.values()) {
      if (client.info?.name === name && client.registered) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Get health status
   */
  private getHealthStatus() {
    const clients = Array.from(this.clients.values())
      .filter((c) => c.registered)
      .map((c) => ({
        id: c.id,
        type: c.info?.type,
        name: c.info?.name,
      }));

    return {
      status: "ok",
      uptime: process.uptime(),
      clients: clients.length,
      clientDetails: clients,
      sessions: this.sessionManager.getStats(),
    };
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Gateway Client wrapper
 */
class GatewayClient {
  registered = false;
  info?: ClientInfo;
  lastHeartbeat = Date.now();

  constructor(
    public id: string,
    public ws: WebSocket,
  ) {}

  send(message: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendError(code: string, message: string): void {
    this.send(createError(code, message));
  }
}
