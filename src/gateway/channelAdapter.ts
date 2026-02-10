// src/gateway/channel-adapter.ts

import WebSocket from "ws";
import {
  ChannelAdapter as BaseChannel,
  NormalizedMessage,
} from "../channels/base";
import {
  GatewayMessage,
  AgentMessageMessage,
  ChannelSendMessage,
  ClientInfo,
} from "./protocol";
import { logger } from "../utils/logger";

/**
 * Adapter that wraps existing channels and connects them to gateway via WS
 *
 * Flow:
 * 1. Channel receives message → sends to gateway via WS
 * 2. Gateway routes to agent
 * 3. Agent responds via gateway
 * 4. Gateway sends back to channel adapter
 * 5. Channel adapter delivers via original channel
 */
export class ChannelAdapter {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly reconnectDelay = 5000;
  private clientInfo: ClientInfo;

  constructor(
    private channel: BaseChannel,
    private channelName: string,
    private gatewayUrl: string = "ws://localhost:18789",
  ) {
    this.clientInfo = {
      id: `channel-${channelName}`,
      type: "channel",
      name: `channel-${channelName}`,
      capabilities: ["send", "typing"],
      metadata: { channelType: channelName },
    };
  }

  /**
   * Connect to gateway and register
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.on("open", () => {
        logger.success(`📡 Channel ${this.channelName} connected to gateway`);

        // Register with gateway
        this.send({
          type: "client.register",
          clientInfo: this.clientInfo,
        });

        // Setup heartbeat
        this.startHeartbeat();

        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleGatewayMessage(data);
      });

      this.ws.on("close", () => {
        logger.warn(`Channel ${this.channelName} disconnected from gateway`);
        this.scheduleReconnect();
      });

      this.ws.on("error", (error) => {
        logger.error(`Gateway WS error for ${this.channelName}:`, error);
        reject(error);
      });
    });
  }

  /**
   * Handle incoming message from channel (user → gateway)
   */
  async handleChannelMessage(message: NormalizedMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error("Gateway not connected, cannot forward message");
      return;
    }

    // Convert to gateway protocol
    const gatewayMsg: AgentMessageMessage = {
      type: "agent.message",
      sessionId: "", // Will be set by gateway
      from: `${message.channel}:${message.userId}`,
      content: message.content,
      username: message.username,
      metadata: {
        groupId: message.groupId,
        timestamp: new Date().toISOString(),
        ...message.metadata,
      },
    };

    this.send(gatewayMsg);
    logger.info(
      `→ Forwarded to gateway: ${message.content.substring(0, 50)}...`,
    );
  }

  /**
   * Handle message from gateway (agent → channel)
   */
  private async handleGatewayMessage(data: WebSocket.Data): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      switch (message.type) {
        case "channel.send":
          await this.handleChannelSend(message);
          break;

        case "channel.typing":
          await this.handleTyping(message);
          break;

        case "ack":
          // Registration acknowledged
          logger.info(`Gateway ACK: ${JSON.stringify(message)}`);
          break;

        case "error":
          logger.error(`Gateway error: ${message.message}`);
          break;

        default:
          logger.warn(
            `Unknown message type from gateway: ${(message as any).type}`,
          );
      }
    } catch (error: any) {
      logger.error("Error handling gateway message:", error);
    }
  }

  /**
   * Handle channel.send - deliver message via channel
   */
  //   private async handleChannelSend(message: ChannelSendMessage): Promise<void> {
  //     try {
  //       await this.channel.sendMessage(
  //         message.userId,
  //         message.content,
  //         message.groupId,
  //       );
  //       logger.success(
  //         `✉️  Delivered via ${this.channelName}: ${message.content.substring(0, 50)}...`,
  //       );
  //     } catch (error: any) {
  //       logger.error(`Failed to send via ${this.channelName}:`, error);
  //     }
  //   }
  /**
   * Handle channel.send - deliver message via channel
   */
  /**
   * Handle channel.send - deliver message via channel
   */
  private async handleChannelSend(message: ChannelSendMessage): Promise<void> {
    try {
      // Validate message is not empty
      if (!message.content || message.content.trim() === "") {
        logger.warn(
          `Skipping empty message send for channel ${this.channelName}`,
        );
        return;
      }

      await this.channel.sendMessage(message.userId, {
        text: message.content,
        metadata: message.groupId ? { groupId: message.groupId } : undefined,
      });

      logger.success(
        `✉️  Delivered via ${this.channelName}: ${message.content.substring(0, 50)}...`,
      );
    } catch (error: any) {
      logger.error(`Failed to send via ${this.channelName}:`, error);
    }
  }

  /**
   * Handle typing indicator
   */
  private async handleTyping(message: any): Promise<void> {
    try {
      if (this.channel.sendTypingIndicator) {
        await this.channel.sendTypingIndicator(message.userId, message.groupId);
      }
    } catch (error: any) {
      logger.error(`Failed to send typing via ${this.channelName}:`, error);
    }
  }

  /**
   * Send message to gateway
   */
  private send(message: GatewayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: "client.heartbeat",
          clientId: this.clientInfo.id,
          timestamp: new Date().toISOString(),
        });
      }
    }, 30000);
  }

  /**
   * Schedule reconnect on disconnect
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      logger.info(`Reconnecting ${this.channelName} to gateway...`);
      this.connect().catch((error) => {
        logger.error(`Reconnect failed for ${this.channelName}:`, error);
      });
    }, this.reconnectDelay);
  }

  /**
   * Disconnect from gateway
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
