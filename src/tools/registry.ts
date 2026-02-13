// src/tools/registry.ts

import { Tool } from "@anthropic-ai/sdk/resources";
import { logger } from "../utils/logger";
import {
  ToolDefinition,
  ToolFunction,
  ToolStats,
  ToolFilter,
  ToolCategory,
  toAnthropicTool,
} from "./types";

/**
 * Central registry for all agent tools.
 * Provides unified tool management, discovery, and execution.
 *
 * Design principles:
 * - Single source of truth for tool definitions
 * - Self-registration pattern (tools register themselves)
 * - Runtime discoverability
 * - Type-safe execution
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private initialized = false;

  /**
   * Register a single tool
   */
  register(tool: ToolDefinition): void {
    // Validate uniqueness
    if (this.tools.has(tool.name)) {
      throw new Error(
        `Tool registration conflict: '${tool.name}' already exists`,
      );
    }

    // Validate schema
    if (!tool.input_schema || tool.input_schema.type !== "object") {
      throw new Error(
        `Tool '${tool.name}' has invalid input_schema (must be type: "object")`,
      );
    }

    // Set default enabled state
    if (tool.enabled === undefined) {
      tool.enabled = true;
    }

    this.tools.set(tool.name, tool);
    logger.debug(
      `Registered tool: ${tool.name} (category: ${tool.category}, enabled: ${tool.enabled})`,
    );
  }

  /**
   * Register multiple tools at once
   */
  registerBulk(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get tool definitions in Anthropic format for LLM consumption
   * Only returns enabled tools
   */
  getDefinitions(filter?: ToolFilter): Tool[] {
    return Array.from(this.tools.values())
      .filter((tool) => this.matchesFilter(tool, filter))
      .filter((tool) => tool.enabled !== false)
      .map(toAnthropicTool);
  }

  /**
   * Get executable functions mapped by tool name
   * Only returns enabled tools
   */
  getFunctions(filter?: ToolFilter): Record<string, ToolFunction> {
    const functions: Record<string, ToolFunction> = {};

    for (const tool of this.tools.values()) {
      if (this.matchesFilter(tool, filter) && tool.enabled !== false) {
        functions[tool.name] = tool.function;
      }
    }

    return functions;
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools with metadata (for introspection/debugging)
   */
  list(filter?: ToolFilter): Array<{
    name: string;
    category: ToolCategory;
    enabled: boolean;
    description: string;
  }> {
    return Array.from(this.tools.values())
      .filter((tool) => this.matchesFilter(tool, filter))
      .map((tool) => ({
        name: tool.name,
        category: tool.category,
        enabled: tool.enabled !== false,
        description: tool.description,
      }));
  }

  /**
   * Enable a tool by name
   */
  enable(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    tool.enabled = true;
    logger.info(`Enabled tool: ${name}`);
    return true;
  }

  /**
   * Disable a tool by name
   */
  disable(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;

    tool.enabled = false;
    logger.info(`Disabled tool: ${name}`);
    return true;
  }

  /**
   * Check if a tool is enabled
   */
  isEnabled(name: string): boolean {
    const tool = this.tools.get(name);
    return tool ? tool.enabled !== false : false;
  }

  /**
   * Get registry statistics
   */
  getStats(): ToolStats {
    const stats: ToolStats = {
      total: this.tools.size,
      enabled: 0,
      disabled: 0,
      byCategory: {
        core: 0,
        communication: 0,
        memory: 0,
        scheduler: 0,
        skills: 0,
        system: 0,
      },
    };

    for (const tool of this.tools.values()) {
      if (tool.enabled !== false) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      stats.byCategory[tool.category] =
        (stats.byCategory[tool.category] || 0) + 1;
    }

    return stats;
  }

  /**
   * Validate all registered tools for name collisions
   */
  validateUnique(): void {
    const names = new Set<string>();
    const duplicates: string[] = [];

    for (const tool of this.tools.values()) {
      if (names.has(tool.name)) {
        duplicates.push(tool.name);
      }
      names.add(tool.name);
    }

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate tool names detected: ${duplicates.join(", ")}`,
      );
    }
  }

  /**
   * Clear all registered tools (for testing)
   */
  clear(): void {
    this.tools.clear();
    this.initialized = false;
    logger.debug("Registry cleared");
  }

  /**
   * Mark registry as initialized (prevents re-registration)
   */
  markInitialized(): void {
    this.initialized = true;
    logger.info(
      `Tool registry initialized: ${this.tools.size} tools registered`,
    );
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if a tool matches the given filter
   */
  private matchesFilter(tool: ToolDefinition, filter?: ToolFilter): boolean {
    if (!filter) return true;

    if (filter.category && tool.category !== filter.category) {
      return false;
    }

    if (filter.enabled !== undefined && tool.enabled !== filter.enabled) {
      return false;
    }

    if (filter.namePattern) {
      const regex = new RegExp(filter.namePattern, "i");
      if (!regex.test(tool.name)) {
        return false;
      }
    }

    return true;
  }
}

// Singleton instance
export const registry = new ToolRegistry();
