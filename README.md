# Noni AI Agent MVP

A minimal viable AI agent that runs on Telegram with essential tools and in-memory state management.

## Features

- 🤖 Telegram bot interface
- 🧠 Claude Sonnet 4.5 as the brain
- 🛠️ 5 Essential tools:
  - Weather lookup
  - Web search
  - File operations (read/write)
  - Code execution (Python)
  - Calculator
- 💾 In-memory conversation state
- 🔄 Autonomous tool execution

## Architecture

```
Telegram User
    ↓
Telegram Bot API
    ↓
Message Handler
    ↓
Orchestrator (decides what to do)
    ↓
Claude API (with tools)
    ↓
Tool Executor
    ↓
Response back to user
```

## Setup

### 1. Prerequisites

```bash
python 3.11+
pip
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Get API Keys

**Telegram Bot Token:**
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow instructions
3. Copy the token (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

**Anthropic API Key:**
1. Go to https://console.anthropic.com/
2. Create an API key
3. Copy it

**Optional - SerpAPI (for web search):**
1. Go to https://serpapi.com/
2. Sign up for free tier
3. Copy API key

### 4. Configure Environment

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_token_here
ANTHROPIC_API_KEY=your_anthropic_key_here
SERPAPI_KEY=your_serpapi_key_here  # Optional
```

### 5. Run the Agent

```bash
python main.py
```

## Usage

Once the bot is running, open Telegram and:

1. Search for your bot by username
2. Send `/start` to initialize
3. Start chatting!

### Example Interactions

```
You: What's the weather in Tokyo?
Bot: [Uses weather tool] The weather in Tokyo is...

You: Search for the latest AI news
Bot: [Uses web search] Here are the latest AI developments...

You: Create a file called hello.txt with "Hello World"
Bot: [Uses file tool] File created successfully!

You: Calculate 1234 * 5678
Bot: [Uses calculator] The result is 7,006,652
```

## Project Structure

```
telegram-agent-mvp/
├── main.py                 # Entry point
├── agent/
│   ├── __init__.py
│   ├── orchestrator.py     # Main agent logic
│   ├── llm_interface.py    # Claude API wrapper
│   └── memory.py          # In-memory state management
├── tools/
│   ├── __init__.py
│   ├── weather.py         # Weather tool
│   ├── web_search.py      # Web search tool
│   ├── file_ops.py        # File operations
│   ├── code_executor.py   # Python code execution
│   └── calculator.py      # Math calculations
├── telegram_bot/
│   ├── __init__.py
│   └── handler.py         # Telegram message handling
├── config.py              # Configuration
├── requirements.txt       # Python dependencies
└── README.md
```

## Security Notes

⚠️ **This is an MVP - NOT production ready!**

- Code execution is NOT sandboxed (dangerous!)
- File operations have full access (dangerous!)
- No rate limiting
- No user authentication beyond Telegram
- No data persistence

For production, you MUST add:
- Docker sandboxing for code execution
- File system restrictions
- Rate limiting
- User permission system
- Database for state persistence
- Error handling and logging

## Next Steps

After getting this MVP working:

1. Add database (PostgreSQL + Redis)
2. Implement proper sandboxing
3. Add more messaging platforms (WhatsApp, Discord)
4. Implement multi-agent system
5. Add vector memory (Pinecone/Weaviate)
6. Deploy to cloud (AWS/GCP/Azure)

## Troubleshooting

**Bot not responding:**
- Check if bot token is correct
- Verify bot is running (`python main.py` should show "Bot started")
- Check Telegram bot has proper permissions

**Tools not working:**
- Verify API keys in `.env`
- Check internet connection
- Look at console logs for errors

**Rate limits:**
- Anthropic: 50 requests/min on free tier
- SerpAPI: 100 searches/month on free tier

## Cost Estimation

For MVP testing (100 messages/day):
- Anthropic Claude: ~$0.10-0.50/day
- SerpAPI: Free tier sufficient
- **Total: < $15/month**

## License

MIT
