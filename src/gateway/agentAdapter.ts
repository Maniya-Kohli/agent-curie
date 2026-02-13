// src/gateway/agent-adapter.ts

import WebSocket from "ws";
import { AgentOrchestrator } from "../agent/orchestrator";
import {
  GatewayMessage,
  AgentMessageMessage,
  AgentResponseMessage,
  ClientInfo,
} from "./protocol";
import { logger } from "../utils/logger";

/**
 * Adapter that connects the agent orchestrator to the gateway
 *
 * Flow:
 * 1. Receives agent.message from gateway
 * 2. Forwards to orchestrator for processing
 * 3. Gets response from orchestrator
 * 4. Sends agent.response back to gateway
 */
export class AgentAdapter {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly reconnectDelay = 5000;
  private clientInfo: ClientInfo;

  constructor(
    private orchestrator: AgentOrchestrator,
    private gatewayUrl: string = "ws://localhost:18789",
  ) {
    this.clientInfo = {
      id: "agent-main",
      type: "agent",
      name: "curie-agent",
      capabilities: ["process", "think", "respond"],
      metadata: {
        model: "claude-sonnet-4-5-20250929",
      },
    };
  }

  /**
   * Connect to gateway and register
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.on("open", () => {
        logger.success("🤖 Agent connected to gateway");

        // Register
        this.send({
          type: "client.register",
          clientInfo: this.clientInfo,
        });

        // Start heartbeat
        this.startHeartbeat();

        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleGatewayMessage(data);
      });

      this.ws.on("close", () => {
        logger.warn("Agent disconnected from gateway");
        this.scheduleReconnect();
      });

      this.ws.on("error", (error) => {
        logger.error("Agent gateway WS error:", error);
        reject(error);
      });
    });
  }

  /**
   * Handle message from gateway
   */
  private async handleGatewayMessage(data: WebSocket.Data): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      switch (message.type) {
        case "agent.message":
          await this.handleAgentMessage(message);
          break;

        case "ack":
          logger.info("Gateway ACK received");
          break;

        case "error":
          logger.error(`Gateway error: ${message.message}`);
          break;

        default:
          logger.warn(`Unknown message from gateway: ${(message as any).type}`);
      }
    } catch (error: any) {
      logger.error("Error handling gateway message:", error);
    }
  }

  /**
   * Handle agent.message - process and respond
   */

  private async handleAgentMessage(
    message: AgentMessageMessage,
  ): Promise<void> {
    try {
      const hasMedia = message.metadata?.attachment?.base64Data
        ? " (with media)"
        : "";
      logger.info(
        `🧠 Processing: ${message.content.substring(0, 50)}...${hasMedia}`,
      );

      // Send typing indicator
      this.send({
        type: "agent.typing",
        sessionId: message.sessionId,
        isTyping: true,
      });

      // Process through orchestrator - PASS METADATA
      const response = await this.orchestrator.handleUserMessage(
        message.from,
        message.content,
        message.username,
        message.metadata, // ← Pass metadata containing attachment
      );

      // Send typing indicator off
      this.send({
        type: "agent.typing",
        sessionId: message.sessionId,
        isTyping: false,
      });

      // Send response back
      const responseMsg: AgentResponseMessage = {
        type: "agent.response",
        sessionId: message.sessionId,
        content: response,
        metadata: {
          model: "claude-sonnet-4-5-20250929",
        },
      };

      this.send(responseMsg);
      logger.success(`✅ Response sent (${response.length} chars)`);
    } catch (error: any) {
      logger.error("Error processing agent message:", error);

      // Send error response
      this.send({
        type: "agent.response",
        sessionId: message.sessionId,
        content: `Sorry, I encountered an error: ${error.message}`,
      });
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
   * Start heartbeat
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
   * Schedule reconnect
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      logger.info("Reconnecting agent to gateway...");
      this.connect().catch((error) => {
        logger.error("Agent reconnect failed:", error);
      });
    }, this.reconnectDelay);
  }

  /**
   * Disconnect
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
