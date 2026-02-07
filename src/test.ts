import * as dotenv from "dotenv";
import { AgentOrchestrator } from "./agent/orchestrator";
import { TOOL_FUNCTIONS } from "./tools";
import { memory } from "./agent/memory";
import * as fs from "fs/promises";
import * as path from "path";

dotenv.config();

async function runTests() {
  console.log("=".repeat(60));
  console.log("NONI TS - TEST SUITE");
  console.log("=".repeat(60));

  // 1. Check Environment
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log("\n[1] Checking Environment:");
  console.log(
    `  - ANTHROPIC_API_KEY: ${anthropicKey ? "✅ SET" : "❌ MISSING"}`,
  );
  console.log(
    `  - TELEGRAM_BOT_TOKEN: ${telegramToken ? "✅ SET" : "❌ MISSING"}`,
  );

  if (!anthropicKey) {
    console.error("\n❌ Stopping: ANTHROPIC_API_KEY is required for tests.");
    return;
  }

  // 2. Test Individual Tools
  console.log("\n[2] Testing Individual Tools:");

  try {
    // Calculator Test
    const calcResult = await TOOL_FUNCTIONS.calculate({
      expression: "5 * 5 + 10",
    });
    console.log(`  - Calculator: 5 * 5 + 10 = ${calcResult}`);

    // Weather Test
    const weatherResult = await TOOL_FUNCTIONS.get_weather({
      location: "San Francisco",
    });
    console.log(`  - Weather: ${weatherResult.split("\n")[0]}... (First line)`);

    // FileOps Test
    await TOOL_FUNCTIONS.write_file({
      fileName: "test.txt",
      content: "TS Test Successful",
    });
    const fileContent = await TOOL_FUNCTIONS.read_file({
      fileName: "test.txt",
    });
    console.log(`  - FileOps: Wrote/Read 'test.txt' -> "${fileContent}"`);
  } catch (err) {
    console.error("  ❌ Tool Test Error:", err);
  }

  // 3. Test Orchestrator & Memory
  console.log("\n[3] Testing Orchestrator Logic:");
  const orchestrator = new AgentOrchestrator(anthropicKey);
  const testUserId = "test_maniya_01";

  try {
    console.log("  - Sending message to Noni...");
    const response = await orchestrator.handleUserMessage(
      testUserId,
      "Hello! Tell me a fun fact about San Francisco.",
    );
    console.log(`  - Noni Response: ${response.substring(0, 100)}...`);

    // 4. Test Statistics
    console.log("\n[4] Checking Memory Stats:");
    const stats = orchestrator.getStats();
    console.log(`  - Total Users: ${stats.totalUsers}`);
    console.log(`  - Total Messages in RAM: ${stats.totalMessagesInMemory}`);
  } catch (err) {
    console.error("  ❌ Orchestrator Error:", err);
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST SUITE COMPLETE");
  console.log("=".repeat(60));
  console.log("If successful, run with: npm start");
}

runTests().catch(console.error);
