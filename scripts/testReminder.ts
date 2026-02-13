// Reminder System Diagnostic Script
// Run this to check if reminders are being created and delivered

import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.join(process.cwd(), "curie.db");
const db = new Database(dbPath);

console.log("=== REMINDER SYSTEM DIAGNOSTIC ===\n");

// 1. Check if reminders table exists
console.log("1. Checking reminders table...");
try {
  const tableInfo = db.prepare("PRAGMA table_info(reminders)").all();
  if (tableInfo.length === 0) {
    console.log("❌ ERROR: reminders table does not exist!");
    console.log("   Run database initialization to create the table.");
  } else {
    console.log("✅ reminders table exists");
    console.log("   Columns:", tableInfo.map((c: any) => c.name).join(", "));
  }
} catch (e) {
  console.log("❌ ERROR checking table:", e);
}

// 2. Check all reminders
console.log("\n2. Checking all reminders in database...");
try {
  const allReminders = db.prepare("SELECT * FROM reminders").all();
  console.log(`   Found ${allReminders.length} total reminders`);

  if (allReminders.length > 0) {
    console.log("\n   Reminder breakdown:");
    const pending = allReminders.filter(
      (r: any) => !r.delivered && !r.completed,
    );
    const delivered = allReminders.filter((r: any) => r.delivered);
    const completed = allReminders.filter((r: any) => r.completed);

    console.log(`   - Pending: ${pending.length}`);
    console.log(`   - Delivered: ${delivered.length}`);
    console.log(`   - Completed: ${completed.length}`);

    console.log("\n   All reminders:");
    allReminders.forEach((r: any, i: number) => {
      const now = new Date();
      const triggerAt = new Date(r.trigger_at);
      const isPast = triggerAt < now;
      const minUntil = Math.round(
        (triggerAt.getTime() - now.getTime()) / 60000,
      );

      console.log(`\n   [${i + 1}] ${r.content}`);
      console.log(`       ID: ${r.id}`);
      console.log(`       User: ${r.user_id}`);
      console.log(`       Channel: ${r.channel}`);
      console.log(`       Trigger: ${r.trigger_at}`);
      console.log(
        `       Status: delivered=${r.delivered}, completed=${r.completed}`,
      );
      console.log(
        `       Time: ${isPast ? `PAST (${Math.abs(minUntil)} min ago)` : `FUTURE (in ${minUntil} min)`}`,
      );
    });
  }
} catch (e) {
  console.log("❌ ERROR:", e);
}

// 3. Check for due reminders
console.log("\n3. Checking for DUE reminders (should be delivered now)...");
try {
  const now = new Date().toISOString();
  const dueReminders = db
    .prepare(
      `SELECT * FROM reminders 
     WHERE delivered = 0 AND completed = 0 AND trigger_at <= ?
     ORDER BY trigger_at ASC`,
    )
    .all(now);

  if (dueReminders.length === 0) {
    console.log("   ✅ No reminders currently due");
  } else {
    console.log(
      `   ⚠️  ${dueReminders.length} reminder(s) are DUE but not delivered!`,
    );
    dueReminders.forEach((r: any) => {
      console.log(`      - "${r.content}" (trigger: ${r.trigger_at})`);
    });
    console.log(
      "\n   This suggests the reminder delivery engine is not running!",
    );
  }
} catch (e) {
  console.log("❌ ERROR:", e);
}

// 4. Check scheduled tasks
console.log("\n4. Checking scheduled tasks...");
try {
  const tasks = db.prepare("SELECT * FROM scheduled_tasks").all();
  console.log(`   Found ${tasks.length} scheduled tasks`);

  if (tasks.length > 0) {
    tasks.forEach((t: any, i: number) => {
      console.log(`\n   [${i + 1}] ${t.name}`);
      console.log(`       Schedule: ${t.schedule}`);
      console.log(`       Enabled: ${t.enabled ? "YES" : "NO"}`);
      console.log(`       Next run: ${t.next_run || "Not scheduled"}`);
    });
  }
} catch (e) {
  // Table might not exist
  console.log("   ⚠️  scheduled_tasks table might not exist");
}

console.log("\n=== DIAGNOSTIC COMPLETE ===\n");

// 5. Recommendations
console.log("RECOMMENDATIONS:");
console.log("1. Check bot.log for errors during reminder engine startup");
console.log("2. Verify reminderManager.start() is being called in index.ts");
console.log("3. Ensure gateway is set before calling start()");
console.log("4. Look for any exceptions during checkAndDeliver()");
console.log("5. Test with: 'remind me to test in 1 minute'");

db.close();
