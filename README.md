# Noni — Personal AI Assistant

An AI agent that actually does things. Runs on your Mac, talks on WhatsApp/Telegram/Discord, remembers everything, controls native apps, and learns new skills through conversation.

## What It Does

- **Multi-Channel**: Telegram, Discord, WhatsApp — same brain, same memory across all
- **Persistent Memory**: Markdown files as source of truth (MEMORY.md for long-term knowledge, daily logs for running context) backed by SQLite hybrid search combining BM25 keyword matching and vector embeddings (OpenAI text-embedding-3-small). Scores merged via 0.7 × vector + 0.3 × BM25 for best-of-both retrieval. The LLM writes memory directly via tools — no extraction pipeline. Facts are updated in-place with timestamps, not just appended. This allows for temporal intelligence. Survives restarts, searchable across all history.memory
- **Skills Framework**: Extensible via `SKILL.md` files. Noni can create its own skills at runtime
- **Native macOS Integration**: Controls Apple Reminders, Notes, and other apps via AppleScript
- **WebChat + PWA**: Browser-based chat UI, installable on iPhone as a home screen app
- **Tool Integration**: Gmail, Google Calendar, web search, calculator, file ops, cross-channel messaging
- **Identity-Aware**: Knows who's talking (owner vs contacts), adjusts behavior accordingly
- **Contact Directory**: Alias-based resolution — "send mom a message" just works

## Quick Start

```bash
npm install
cp .env.example .env
# Configure tokens in .env
npm run dev
```

Noni starts all channels + WebChat server on `http://localhost:3000`.

## Architecture

```
src/
├── agent/           # Orchestrator, LLM interface, conversation memory
├── api/             # HTTP API + WebSocket server for WebChat
├── channels/        # Telegram, Discord, WhatsApp adapters
├── memory/          # Context manager, embedder, chunker, indexer, search
├── skills/          # Skill loader, registry, manager
├── tools/           # Gmail, calendar, messaging, exec, etc.
└── db/              # Drizzle schema + SQLite

public/              # WebChat UI (PWA-ready)
├── index.html
├── manifest.json
└── sw.js

workspace/
├── SOUL.md          # Agent persona + instructions
├── USER.md          # Owner profile
├── MEMORY.md        # Long-term memory (auto-managed)
├── memory/          # Daily logs (YYYY-MM-DD.md)
├── notes/           # Markdown notes
└── skills/          # Installed skills
    ├── reminders/   # Apple Reminders integration
    └── notes/       # Apple Notes integration
```

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (enable what you use)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
WHATSAPP_ENABLED=true

# Memory (optional — enables vector search)
OPENAI_API_KEY=sk-...

# WebChat (optional)
NONI_API_PORT=3000
NONI_API_TOKEN=              # Leave empty for local-only open access
```

### Personal Files (git-ignored)

| File                      | Purpose                            |
| ------------------------- | ---------------------------------- |
| `workspace/SOUL.md`       | Agent personality and instructions |
| `workspace/USER.md`       | Owner bio and dynamic context      |
| `workspace/MEMORY.md`     | Long-term memory (managed by Noni) |
| `src/memory/directory.ts` | Contact aliases and phone numbers  |

## Memory System

Inspired by [OpenClaw](https://github.com/openclaw/openclaw)'s architecture:

- **MEMORY.md** — curated long-term knowledge. Noni writes here when it learns durable facts
- **memory/YYYY-MM-DD.md** — daily logs. Running context for each day
- **SQLite** — search index with FTS5 (keyword) + vector embeddings (semantic)
- **Hybrid search** — `0.7 × vector + 0.3 × BM25` merge for best-of-both retrieval

Noni has three memory tools: `memory_write`, `memory_read`, `memory_search`.

## Skills

Skills are `SKILL.md` files that teach Noni new capabilities without code changes.

```
workspace/skills/
├── reminders/SKILL.md    # Apple Reminders via osascript
├── notes/SKILL.md        # Apple Notes via osascript
└── your-skill/SKILL.md   # Create your own
```

**Create skills via chat**: "Create a skill for tracking my expenses" → Noni writes the SKILL.md itself.

**Manage via chat**: "List my skills", "Disable the notes skill"

Skills follow the [AgentSkills](https://docs.anthropic.com) format (same as OpenClaw, Claude Code, Cursor).

## WebChat & Mobile Access

Noni runs an HTTP + WebSocket server alongside messaging channels.

- **Browser**: `http://localhost:3000`
- **iPhone**: Open in Safari → Share → "Add to Home Screen" (PWA)
- **Remote access**: Use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for HTTPS:
  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```

### API Endpoints

| Method | Path          | Description                  |
| ------ | ------------- | ---------------------------- |
| `POST` | `/api/chat`   | Send message, get response   |
| `GET`  | `/api/health` | Server status                |
| `GET`  | `/api/skills` | List installed skills        |
| `GET`  | `/api/memory` | View MEMORY.md               |
| `GET`  | `/api/stats`  | System stats                 |
| `WS`   | `/`           | WebSocket for real-time chat |

## Usage Examples

**Reminders**: "Remind me to call the dentist tomorrow at 10am" → Creates in Apple Reminders (syncs to iPhone)

**Notes**: "Take a note about today's meeting decisions" → Creates in Apple Notes

**Messages**: "Send WhatsApp to mom saying I'll be late"

**Email**: "Email the team a summary of today's standup"

**Memory**: "Remember that I prefer dark mode for everything"

**Skills**: "Create a skill for tracking my daily water intake"

**Search**: "What's the latest news about AI regulation?"

**Pause**: "noni stop" / "noni start" (WhatsApp)

## WhatsApp Setup

1. Set `WHATSAPP_ENABLED=true` in `.env`
2. Run Noni — QR code appears in terminal
3. Scan with WhatsApp on your phone
4. Bot responds on your behalf with auto-signatures for non-owner contacts

## Tech Stack

- **Runtime**: TypeScript / Node.js
- **LLM**: Claude Sonnet 4.5 (Anthropic API)
- **Database**: SQLite + Drizzle ORM + FTS5
- **Embeddings**: OpenAI text-embedding-3-small
- **Channels**: Telegraf, Discord.js, Baileys (WhatsApp)
- **APIs**: Google (Gmail, Calendar), macOS (osascript)
- **Web**: Native HTTP/WS server, PWA

## License ||

MIT
