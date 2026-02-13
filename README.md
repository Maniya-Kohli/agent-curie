# Curie — Personal AI Assistant

An AI agent that actually does things. Runs on your Mac, talks on WhatsApp/Telegram/Discord, remembers everything, controls native apps, and learns new skills through conversation.

## What It Does

- **Multi-Channel**: Telegram, Discord, WhatsApp — same brain, same memory across all
- **Persistent Memory**: Markdown files as source of truth (MEMORY.md for long-term knowledge, daily logs for running context) backed by SQLite hybrid search combining BM25 keyword matching and vector embeddings. Survives restarts, searchable across all history.
- **Skills Framework**: Extensible via `SKILL.md` files. Curie can create its own skills at runtime
- **Native macOS Integration**: Controls Apple Reminders, Notes, and other apps via AppleScript
- **WebChat + PWA**: Browser-based chat UI, installable on iPhone as a home screen app
- **Tool Integration**: Gmail, Google Calendar, web search, calculator, file ops, cross-channel messaging, Coinbase x402 payments
- **Identity-Aware**: Knows who's talking (owner vs contacts), adjusts behavior accordingly
- **Contact Directory**: Alias-based resolution — "send mom a message" just works

## Quick Start

```bash
npm install
cp .env.example .env
# Configure tokens in .env
npm run dev
```

Curie starts all channels + WebChat server on `http://localhost:3000`.

## Architecture

```
src/
├── agent/           # Orchestrator, LLM interface, conversation memory
├── api/             # HTTP API + WebSocket server for WebChat
├── channels/        # Telegram, Discord, WhatsApp adapters
├── memory/          # Context manager, embedder, chunker, indexer, search
├── skills/          # Skill loader, registry, manager
├── tools/           # Gmail, calendar, messaging, exec, images, payments, etc.
└── db/              # Drizzle schema + SQLite

public/              # WebChat UI (PWA-ready)
├── index.html
├── manifest.json
└── sw.js

workspace/
├── SOUL.md          # Agent identity + operating principles
├── AGENTS.md        # Session rules, memory discipline, skill authoring
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
# LLM Provider (pick one)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-5-20250929

# or
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Channels (enable what you use)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
WHATSAPP_ENABLED=true

# Memory (optional — enables vector search)
OPENAI_API_KEY=sk-...   # used for embeddings regardless of LLM provider

# WebChat (optional)
CURIE_API_PORT=3000
CURIE_API_TOKEN=        # Leave empty for local-only open access

# Payments (optional)
CDP_API_KEY_NAME=...
CDP_API_KEY_PRIVATE_KEY=...
X402_ENABLED=true
```

### Personal Files (git-ignored)

| File                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `workspace/SOUL.md`       | Agent identity and principles               |
| `workspace/AGENTS.md`     | Session startup rules and memory discipline |
| `workspace/USER.md`       | Owner bio and dynamic context               |
| `workspace/MEMORY.md`     | Long-term memory (managed by Curie)         |
| `src/memory/directory.ts` | Contact aliases and phone numbers           |

## Memory System

- **MEMORY.md** — curated long-term knowledge. Curie writes here automatically when it learns durable facts (preferences, relationships, projects, decisions)
- **memory/YYYY-MM-DD.md** — daily logs. Running context written after each conversation
- **SQLite** — search index with FTS5 (keyword) + vector embeddings (semantic)
- **Hybrid search** — `0.7 × vector + 0.3 × BM25` merge for best-of-both retrieval

Curie has three memory tools: `memory_write`, `memory_read`, `memory_search`.

## Skills

Skills are `SKILL.md` files that teach Curie new capabilities without code changes.

```
workspace/skills/
├── reminders/SKILL.md    # Apple Reminders via osascript
├── notes/SKILL.md        # Apple Notes via osascript
└── your-skill/SKILL.md   # Create your own
```

**Create skills via chat**: "When I send you an image and say remember this, send it back whenever I crack a joke" → Curie writes the SKILL.md itself.

**Manage via chat**: "List my skills", "Disable the notes skill"

## Image Memory

Curie can save and recall images across conversations:

- **Save**: Send an image with "save this as my reaction image"
- **Trigger**: "Send my reaction image whenever I say well done"
- Curie creates a skill that fires automatically on matching messages

## Payments (x402)

Curie supports [Coinbase x402](https://x402.org) for autonomous micropayments:

- Hit payment-gated APIs without manual intervention
- Handles the full 402 → sign → retry flow automatically
- Requires a CDP API key and wallet with USDC on Base

## WebChat & Mobile Access

- **Browser**: `http://localhost:3000`
- **iPhone**: Open in Safari → Share → "Add to Home Screen" (PWA)
- **Remote access**: Use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):
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

**Reminders**: "Remind me to call the dentist tomorrow at 10am"

**Notes**: "Take a note about today's meeting decisions"

**Messages**: "Send WhatsApp to mom saying I'll be late"

**Email**: "Email the team a summary of today's standup"

**Memory**: "Remember that I prefer dark mode for everything"

**Skills**: "Create a skill for tracking my daily water intake"

**Search**: "What's the latest news about AI regulation?"

**Pause**: "curie stop" / "curie start" (WhatsApp)

## WhatsApp Setup

1. Set `WHATSAPP_ENABLED=true` in `.env`
2. Run Curie — QR code appears in terminal
3. Scan with WhatsApp on your phone

## Tech Stack

- **Runtime**: TypeScript / Node.js
- **LLM**: Anthropic (Claude) or OpenAI (GPT) — configurable via `LLM_PROVIDER`
- **Database**: SQLite + Drizzle ORM + FTS5
- **Embeddings**: OpenAI text-embedding-3-small
- **Channels**: Telegraf, Discord.js, Baileys (WhatsApp)
- **APIs**: Google (Gmail, Calendar), macOS (osascript), Coinbase (x402)
- **Web**: Native HTTP/WS server, PWA

## License

MIT
