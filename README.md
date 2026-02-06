# Noni - Personal AI Assistant

Multi-channel AI agent built with TypeScript, Claude Sonnet 4.5, and OpenClaw architecture patterns.

## Features

- **Multi-Channel Support**: Telegram, Discord, WhatsApp
- **Persistent Memory**: SQLite with Drizzle ORM, fact extraction
- **Contact Directory**: Alias-based contact resolution
- **Tool Integration**: Gmail, calendar, web search, calculations, file ops, messaging
- **Identity Management**: Per-user context with owner detection
- **Auto-signatures**: Signs non-owner messages as "Noni (Maniya's AI Assistant)"
- **Pause/Resume**: `noni stop` and `noni start` commands

## Quick Start

```bash
npm install
cp .env.example .env
# Configure tokens in .env
npm run dev
```

## Configuration

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
WHATSAPP_ENABLED=true
```

### Personal Files (not committed)

- `workspace/SOUL.md` - Agent personality
- `workspace/USER.md` - Owner info
- `src/memory/directory.ts` - Contact aliases

### WhatsApp Setup

1. Run bot
2. Scan QR code with phone
3. Bot responds on your behalf with signatures

## Architecture

```
src/
├── agent/           # Orchestrator, LLM interface
├── channels/        # Telegram, Discord, WhatsApp adapters
├── memory/          # Context, facts, directory
├── tools/           # Gmail, calendar, messaging, etc.
└── db/              # Drizzle schema
```

## Usage

**Send messages**: "Send WhatsApp to mom saying I'll be late"  
**Email**: "Email me a reminder about the meeting"  
**Search**: "What's the weather in SF?"  
**Pause bot**: "noni stop" (WhatsApp)

## Tech Stack

- TypeScript
- Claude Sonnet 4.5
- Telegraf, Discord.js, Baileys
- Drizzle ORM + SQLite
- Google APIs

## License

MIT
