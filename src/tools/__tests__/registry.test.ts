// src/tools/__tests__/registry.test.ts

import { ToolRegistry } from "../registry";
import { ToolDefinition } from "../types";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a valid tool", () => {
      const tool: ToolDefinition = {
        name: "test_tool",
        description: "A test tool",
        category: "core",
        input_schema: {
          type: "object",
          properties: { arg: { type: "string" } },
          required: ["arg"],
        },
        function: async (args: any) => `Hello ${args.arg}`,
      };

      registry.register(tool);
      expect(registry.getTool("test_tool")).toBeDefined();
    });

    it("should throw on duplicate tool names", () => {
      const tool: ToolDefinition = {
        name: "duplicate",
        description: "First",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "first",
      };

      registry.register(tool);

      const duplicate: ToolDefinition = {
        ...tool,
        description: "Second",
      };

      expect(() => registry.register(duplicate)).toThrow(
        "Tool registration conflict",
      );
    });

    it("should throw on invalid input_schema", () => {
      const invalidTool: any = {
        name: "invalid",
        description: "Invalid",
        category: "core",
        input_schema: { type: "string" }, // Wrong type
        function: () => "test",
      };

      expect(() => registry.register(invalidTool)).toThrow(
        "invalid input_schema",
      );
    });

    it("should default enabled to true", () => {
      const tool: ToolDefinition = {
        name: "default_enabled",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      };

      registry.register(tool);
      expect(registry.isEnabled("default_enabled")).toBe(true);
    });
  });

  describe("registerBulk", () => {
    it("should register multiple tools", () => {
      const tools: ToolDefinition[] = [
        {
          name: "tool1",
          description: "Tool 1",
          category: "core",
          input_schema: { type: "object", properties: {} },
          function: () => "1",
        },
        {
          name: "tool2",
          description: "Tool 2",
          category: "memory",
          input_schema: { type: "object", properties: {} },
          function: () => "2",
        },
      ];

      registry.registerBulk(tools);
      expect(registry.getTool("tool1")).toBeDefined();
      expect(registry.getTool("tool2")).toBeDefined();
    });
  });

  describe("getDefinitions", () => {
    beforeEach(() => {
      registry.register({
        name: "enabled_tool",
        description: "Enabled",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "enabled",
        enabled: true,
      });

      registry.register({
        name: "disabled_tool",
        description: "Disabled",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "disabled",
        enabled: false,
      });
    });

    it("should return only enabled tools", () => {
      const definitions = registry.getDefinitions();
      expect(definitions).toHaveLength(1);
      expect(definitions[0].name).toBe("enabled_tool");
    });

    it("should return tools in Anthropic format", () => {
      const definitions = registry.getDefinitions();
      expect(definitions[0]).toHaveProperty("name");
      expect(definitions[0]).toHaveProperty("description");
      expect(definitions[0]).toHaveProperty("input_schema");
      expect(definitions[0]).not.toHaveProperty("function");
    });

    it("should filter by category", () => {
      registry.register({
        name: "memory_tool",
        description: "Memory",
        category: "memory",
        input_schema: { type: "object", properties: {} },
        function: () => "memory",
      });

      const coreTools = registry.getDefinitions({ category: "core" });
      expect(coreTools).toHaveLength(1);
      expect(coreTools[0].name).toBe("enabled_tool");
    });
  });

  describe("getFunctions", () => {
    it("should return executable functions", () => {
      registry.register({
        name: "func_tool",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: (args: any) => `result: ${args.input}`,
      });

      const functions = registry.getFunctions();
      expect(functions.func_tool).toBeDefined();
      expect(functions.func_tool({ input: "test" })).toBe("result: test");
    });

    it("should not return disabled tools", () => {
      registry.register({
        name: "disabled_func",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
        enabled: false,
      });

      const functions = registry.getFunctions();
      expect(functions.disabled_func).toBeUndefined();
    });
  });

  describe("enable/disable", () => {
    beforeEach(() => {
      registry.register({
        name: "toggle_tool",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
        enabled: true,
      });
    });

    it("should disable a tool", () => {
      expect(registry.isEnabled("toggle_tool")).toBe(true);
      registry.disable("toggle_tool");
      expect(registry.isEnabled("toggle_tool")).toBe(false);
    });

    it("should enable a tool", () => {
      registry.disable("toggle_tool");
      expect(registry.isEnabled("toggle_tool")).toBe(false);
      registry.enable("toggle_tool");
      expect(registry.isEnabled("toggle_tool")).toBe(true);
    });

    it("should return false for unknown tools", () => {
      expect(registry.enable("unknown")).toBe(false);
      expect(registry.disable("unknown")).toBe(false);
    });
  });

  describe("getStats", () => {
    beforeEach(() => {
      registry.register({
        name: "core1",
        description: "Core",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });

      registry.register({
        name: "core2",
        description: "Core",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
        enabled: false,
      });

      registry.register({
        name: "memory1",
        description: "Memory",
        category: "memory",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });
    });

    it("should return correct statistics", () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(3);
      expect(stats.enabled).toBe(2);
      expect(stats.disabled).toBe(1);
      expect(stats.byCategory.core).toBe(2);
      expect(stats.byCategory.memory).toBe(1);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      registry.register({
        name: "list_tool",
        description: "A tool for listing",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });
    });

    it("should list all tools with metadata", () => {
      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        name: "list_tool",
        category: "core",
        enabled: true,
        description: "A tool for listing",
      });
    });

    it("should filter by name pattern", () => {
      registry.register({
        name: "another_tool",
        description: "Another",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });

      const filtered = registry.list({ namePattern: "list" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("list_tool");
    });
  });

  describe("validateUnique", () => {
    it("should not throw for unique names", () => {
      registry.register({
        name: "unique1",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });

      registry.register({
        name: "unique2",
        description: "Test",
        category: "core",
        input_schema: { type: "object", properties: {} },
        function: () => "test",
      });

      expect(() => registry.validateUnique()).not.toThrow();
    });
  });

  describe("initialization", () => {
    it("should track initialization state", () => {
      expect(registry.isInitialized()).toBe(false);
      registry.markInitialized();
      expect(registry.isInitialized()).toBe(true);
    });

    it("should clear initialization state on clear", () => {
      registry.markInitialized();
      registry.clear();
      expect(registry.isInitialized()).toBe(false);
    });
  });
});
