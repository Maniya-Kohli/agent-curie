// src/tools/types.ts

import { Tool } from "@anthropic-ai/sdk/resources";

/**
 * Tool category for organization and filtering
 */
export type ToolCategory =
  | "core" // Weather, search, calculator, files
  | "communication" // Email, calendar, messaging
  | "memory" // Memory read/write/search
  | "scheduler" // Reminders, scheduled tasks
  | "skills" // User-installed skills
  | "system"; // Exec, image ops

/**
 * Tool execution function type
 */
export type ToolFunction = (args: any) => Promise<any> | any;

/**
 * Complete tool definition including execution function
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  function: ToolFunction;
  enabled?: boolean; // Default: true
  metadata?: ToolMetadata;
}

/**
 * Tool metadata for display and management
 */
export interface ToolMetadata {
  version?: string;
  author?: string;
  tags?: string[];
  requiresAuth?: boolean;
  rateLimit?: number; // calls per minute
  // Future: permissions model
  // permissions?: {
  //   allowedRoles?: string[];
  //   requiresOwner?: boolean;
  // }
}

/**
 * Tool statistics for monitoring
 */
export interface ToolStats {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<ToolCategory, number>;
}

/**
 * Tool query filters
 */
export interface ToolFilter {
  category?: ToolCategory;
  enabled?: boolean;
  namePattern?: string;
}

/**
 * Convert ToolDefinition to Anthropic Tool format for LLM
 */
export function toAnthropicTool(def: ToolDefinition): Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
  };
}
