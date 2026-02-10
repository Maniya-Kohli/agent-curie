// src/gateway/protocol.ts

/**
 * Gateway Protocol - Message Types
 * All communication flows through WebSocket messages
 */

// ════════════════════════════════════════════════════════════════
// CLIENT TYPES
// ════════════════════════════════════════════════════════════════

export type ClientType =
  | "channel" // WhatsApp, Telegram, Discord
  | "agent" // LLM orchestrator
  | "tool" // Browser, exec, etc.
  | "node" // Device (macOS, iOS, Android)
  | "ui" // Web dashboard, CLI
  | "api"; // External API clients

export interface ClientInfo {
  id: string;
  type: ClientType;
  name: string;
  capabilities?: string[];
  metadata?: Record<string, any>;
}

// ════════════════════════════════════════════════════════════════
// SESSION TYPES
// ════════════════════════════════════════════════════════════════

export interface Session {
  id: string;
  type: "main" | "group" | "dm" | "custom";
  userId: string; // whatsapp:+123456789
  username?: string;
  channel?: string; // whatsapp, telegram, discord
  groupId?: string; // for group chats
  agentId?: string; // which agent handles this
  metadata?: Record<string, any>;
  createdAt: string;
  lastActiveAt: string;
}

// ════════════════════════════════════════════════════════════════
// PROTOCOL MESSAGES
// ════════════════════════════════════════════════════════════════

export type GatewayMessage =
  // Connection lifecycle
  | ClientRegisterMessage
  | ClientUnregisterMessage
  | ClientHeartbeatMessage

  // Session management
  | SessionCreateMessage
  | SessionUpdateMessage
  | SessionListMessage
  | SessionGetMessage

  // Agent communication
  | AgentMessageMessage
  | AgentResponseMessage
  | AgentTypingMessage

  // Tool invocation
  | ToolInvokeMessage
  | ToolResultMessage

  // Node operations
  | NodeInvokeMessage
  | NodeResultMessage
  | NodeListMessage

  // Channel operations
  | ChannelSendMessage
  | ChannelTypingMessage

  // System
  | ErrorMessage
  | AckMessage;

// ────────────────────────────────────────────────────────────────
// Connection Messages
// ────────────────────────────────────────────────────────────────

export interface ClientRegisterMessage {
  type: "client.register";
  clientInfo: ClientInfo;
}

export interface ClientUnregisterMessage {
  type: "client.unregister";
  clientId: string;
}

export interface ClientHeartbeatMessage {
  type: "client.heartbeat";
  clientId: string;
  timestamp: string;
}

// ────────────────────────────────────────────────────────────────
// Session Messages
// ────────────────────────────────────────────────────────────────

export interface SessionCreateMessage {
  type: "session.create";
  session: Partial<Session>;
}

export interface SessionUpdateMessage {
  type: "session.update";
  sessionId: string;
  updates: Partial<Session>;
}

export interface SessionListMessage {
  type: "session.list";
  filter?: {
    userId?: string;
    channel?: string;
    type?: Session["type"];
  };
}

export interface SessionGetMessage {
  type: "session.get";
  sessionId: string;
}

// ────────────────────────────────────────────────────────────────
// Agent Messages
// ────────────────────────────────────────────────────────────────

export interface AgentMessageMessage {
  type: "agent.message";
  sessionId: string;
  from: string; // channel:userId
  content: string;
  username?: string;
  metadata?: Record<string, any>;
}

export interface AgentResponseMessage {
  type: "agent.response";
  sessionId: string;
  content: string;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    cost?: number;
    thinking?: string;
  };
}

export interface AgentTypingMessage {
  type: "agent.typing";
  sessionId: string;
  isTyping: boolean;
}

// ────────────────────────────────────────────────────────────────
// Tool Messages
// ────────────────────────────────────────────────────────────────

export interface ToolInvokeMessage {
  type: "tool.invoke";
  sessionId: string;
  toolName: string;
  input: any;
  requestId: string; // for tracking responses
}

export interface ToolResultMessage {
  type: "tool.result";
  requestId: string;
  result: any;
  error?: string;
}

// ────────────────────────────────────────────────────────────────
// Node Messages
// ────────────────────────────────────────────────────────────────

export interface NodeInvokeMessage {
  type: "node.invoke";
  nodeId: string;
  action: string; // "screenshot", "camera.snap", etc.
  params?: any;
  requestId: string;
}

export interface NodeResultMessage {
  type: "node.result";
  requestId: string;
  result: any;
  error?: string;
}

export interface NodeListMessage {
  type: "node.list";
}

// ────────────────────────────────────────────────────────────────
// Channel Messages
// ────────────────────────────────────────────────────────────────

export interface ChannelSendMessage {
  type: "channel.send";
  channel: string; // whatsapp, telegram, discord
  userId: string;
  content: string;
  groupId?: string;
  replyTo?: string;
}

export interface ChannelTypingMessage {
  type: "channel.typing";
  channel: string;
  userId: string;
  groupId?: string;
  isTyping: boolean;
}

// ────────────────────────────────────────────────────────────────
// System Messages
// ────────────────────────────────────────────────────────────────

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
  requestId?: string;
}

export interface AckMessage {
  type: "ack";
  requestId: string;
  success: boolean;
  data?: any;
}

// ════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

export function parseUserId(userId: string): { channel: string; id: string } {
  const parts = userId.split(":");
  if (parts.length >= 2) {
    return {
      channel: parts[0],
      id: parts.slice(1).join(":"),
    };
  }
  return { channel: "unknown", id: userId };
}

export function formatUserId(channel: string, id: string): string {
  return `${channel}:${id}`;
}

export function validateMessage(msg: any): msg is GatewayMessage {
  return msg && typeof msg === "object" && typeof msg.type === "string";
}

export function createError(
  code: string,
  message: string,
  requestId?: string,
): ErrorMessage {
  return {
    type: "error",
    code,
    message,
    requestId,
  };
}

export function createAck(
  requestId: string,
  success: boolean,
  data?: any,
): AckMessage {
  return {
    type: "ack",
    requestId,
    success,
    data,
  };
}
