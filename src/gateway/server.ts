// src/gateway/server.ts

import WebSocket, { WebSocketServer } from "ws";
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
  private wss: WebSocketServer;
  private httpServer: ReturnType<typeof createServer>;
  private clients = new Map<string, GatewayClient>();
  private sessionManager = new SessionManager();

  constructor(private port: number = 18789) {
    this.httpServer = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getHealthStatus()));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupWebSocketHandlers();
  }

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

  stop(): Promise<void> {
    return new Promise((resolve) => {
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

      this.clients.set(clientId, client);
    });
  }

  private handleMessage(client: GatewayClient, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      if (!validateMessage(message)) {
        client.sendError("INVALID_MESSAGE", "Invalid message format");
        return;
      }

      logger.info(`📨 ${client.id} → ${message.type}`);

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

  private handleClientDisconnect(client: GatewayClient): void {
    logger.info(
      `Client disconnected: ${client.id} (${client.info?.name || "unregistered"})`,
    );
    this.clients.delete(client.id);
  }

  private handleAgentMessage(message: AgentMessageMessage): void {
    const agentClient = this.findClientByType("agent");
    if (!agentClient) {
      logger.error("No agent client connected");
      return;
    }

    const { channel, id: userId } = parseUserId(message.from);
    const session = this.sessionManager.getOrCreateSession(
      userId,
      channel,
      message.metadata?.groupId,
    );

    // Merge metadata so remoteJid and other channel-specific fields are available at response time
    if (message.metadata) {
      session.metadata = {
        ...session.metadata,
        ...message.metadata,
      };
    }

    agentClient.send({
      ...message,
      sessionId: session.id,
    });
  }

  private handleAgentTyping(message: any): void {
    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      logger.error(`Session not found for typing: ${message.sessionId}`);
      return;
    }

    const channelClient = this.findClientByName(`channel-${session.channel}`);
    if (!channelClient) {
      logger.error(`Channel client not found: ${session.channel}`);
      return;
    }

    const { id: userId } = parseUserId(session.userId);
    channelClient.send({
      type: "channel.typing",
      channel: session.channel!,
      userId,
      groupId: session.groupId,
      isTyping: message.isTyping,
    });
  }

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

    // WhatsApp uses remoteJid (e.g. @s.whatsapp.net / @g.us); other channels fall back to userId
    const targetUserId =
      session.metadata?.remoteJid ?? parseUserId(session.userId).id;

    channelClient.send({
      type: "channel.send",
      channel: session.channel!,
      userId: targetUserId,
      content: message.content,
      groupId: session.groupId,
    } as ChannelSendMessage);
  }

  private handleChannelSend(message: ChannelSendMessage): void {
    const channelClient = this.findClientByName(`channel-${message.channel}`);
    if (!channelClient) {
      logger.error(`Channel client not found: ${message.channel}`);
      return;
    }
    channelClient.send(message);
  }

  private handleSessionCreate(_message: any): void {
    // TODO: implement explicit session creation if needed; sessions are auto-created on agent.message
    logger.info("Explicit session creation requested");
  }

  private handleSessionList(client: GatewayClient, message: any): void {
    const sessions = this.sessionManager.listSessions(message.filter);
    client.send(createAck(client.id, true, { sessions }));
  }

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

  private handleToolInvoke(message: any): void {
    const toolClient = this.findClientByType("tool");
    if (!toolClient) {
      logger.error("No tool client connected");
      return;
    }
    toolClient.send(message);
  }

  private handleToolResult(message: any): void {
    const agentClient = this.findClientByType("agent");
    if (!agentClient) {
      logger.error("No agent client to receive tool result");
      return;
    }
    agentClient.send(message);
  }

  private findClientByType(type: string): GatewayClient | undefined {
    for (const client of this.clients.values()) {
      if (client.info?.type === type && client.registered) {
        return client;
      }
    }
    return undefined;
  }

  private findClientByName(name: string): GatewayClient | undefined {
    for (const client of this.clients.values()) {
      if (client.info?.name === name && client.registered) {
        return client;
      }
    }
    return undefined;
  }

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

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Wraps a WebSocket connection with registration state and typed send helpers.
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
