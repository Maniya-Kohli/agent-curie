import { registry } from "./registry";
import { logger } from "../utils/logger";

/**
 * Auto-discovers and registers all tools in the system.
 * Called once during application startup.
 *
 * Registration order:
 * 1. Core tools (src/tools/core/*)
 * 2. Memory tools (src/memory/tools.ts)
 * 3. Scheduler tools (src/scheduler/tools.ts)
 * 4. Skills (src/skills/manager.ts)
 */
export async function loadAllTools(): Promise<void> {
  if (registry.isInitialized()) {
    logger.warn("Tools already loaded, skipping re-initialization");
    return;
  }

  logger.info("Loading all tools...");

  try {
    // Import all tool modules - they self-register via side effects
    await import("./core/weather");
    await import("./core/webSearch");
    await import("./core/calculator");
    await import("./core/fileOps");
    await import("./core/gmail");
    await import("./core/calendar");
    await import("./core/sendMessage");
    await import("./core/exec");
    await import("./core/imageOps");
    await import("./core/x402Payment");

    // Memory tools
    await import("../memory/tools");

    // Scheduler tools
    await import("../scheduler/tools");

    // Skills manager
    await import("../skills/manager");

    registry.markInitialized();

    const stats = registry.getStats();
    logger.success(
      `✅ Tools loaded: ${stats.enabled} enabled, ${stats.disabled} disabled`,
    );
    logger.info(
      `By category: core=${stats.byCategory.core || 0}, communication=${stats.byCategory.communication || 0}, ` +
        `memory=${stats.byCategory.memory || 0}, scheduler=${stats.byCategory.scheduler || 0}, ` +
        `skills=${stats.byCategory.skills || 0}, system=${stats.byCategory.system || 0}`,
    );
  } catch (error: any) {
    logger.error("Failed to load tools:", error);
    throw error;
  }
}

/**
 * Reload tools (for testing or hot-reload scenarios)
 */
export async function reloadTools(): Promise<void> {
  logger.info("Reloading tools...");
  registry.clear();
  await loadAllTools();
}
