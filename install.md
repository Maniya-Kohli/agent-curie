# INSTALLATION GUIDE - Step by Step

## Step 1: Create Project Structure

Create these folders on your computer:

```
mvp-agent/
├── agent/
├── tools/
└── telegram_bot/
```

**How to do this:**

**On Mac/Linux:**

```bash
mkdir mvp-agent
cd mvp-agent
mkdir agent tools telegram_bot
```

**On Windows:**

```cmd
mkdir mvp-agent
cd mvp-agent
mkdir agent
mkdir tools
mkdir telegram_bot
```

---

## Step 2: Download and Place Files

I'll tell you EXACTLY where each file goes:

### ROOT DIRECTORY FILES (put in `mvp-agent/` folder)

1. **main.py** - The main entry point
2. **requirements.txt** - Python dependencies
3. **.env.example** - Template for your API keys (rename to `.env` after adding keys)
4. **test_setup.py** - Test script to verify setup
5. **README.md** - Project overview
6. **SETUP.md** - Detailed setup instructions
7. **ARCHITECTURE.md** - Architecture diagrams

### AGENT FOLDER FILES (put in `mvp-agent/agent/` folder)

1. ****init**.py** - Package initialization
2. **memory.py** - Conversation memory management
3. **llm_interface.py** - Claude API wrapper
4. **orchestrator.py** - Main agent logic

### TOOLS FOLDER FILES (put in `mvp-agent/tools/` folder)

1. ****init**.py** - Tools package initialization
2. **weather.py** - Weather tool
3. **web_search.py** - Web search tool
4. **calculator.py** - Calculator tool
5. **file_ops.py** - File operations (read/write/list)
6. **code_exec.py** - Code execution tool

### TELEGRAM_BOT FOLDER FILES (put in `mvp-agent/telegram_bot/` folder)

1. ****init**.py** - Package initialization
2. **bot.py** - Telegram bot handler

---

## Step 3: Final Structure Check

Your folder structure should look EXACTLY like this:

```
mvp-agent/
│
├── main.py
├── requirements.txt
├── .env.example
├── test_setup.py
├── README.md
├── SETUP.md
├── ARCHITECTURE.md
│
├── agent/
│   ├── __init__.py
│   ├── memory.py
│   ├── llm_interface.py
│   └── orchestrator.py
│
├── tools/
│   ├── __init__.py
│   ├── weather.py
│   ├── web_search.py
│   ├── calculator.py
│   ├── file_ops.py
│   └── code_exec.py
│
└── telegram_bot/
    ├── __init__.py
    └── bot.py
```

---

## Step 4: Install Python Dependencies

Open terminal/command prompt in the `mvp-agent` folder and run:

```bash
pip install -r requirements.txt
```

This installs:

- python-telegram-bot
- anthropic
- python-dotenv
- requests
- google-search-results
- aiohttp
- pydantic

---

## Step 5: Get API Keys

### 5.1 Anthropic API Key (REQUIRED)

1. Go to: https://console.anthropic.com/
2. Sign up or log in
3. Click "API Keys"
4. Create new key
5. Copy it (starts with `sk-ant-`)

### 5.2 Telegram Bot Token (REQUIRED)

1. Open Telegram
2. Search for `@BotFather`
3. Send: `/newbot`
4. Choose name: "My AI Agent"
5. Choose username: "my_ai_agent_bot"
6. Copy the token (looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 5.3 SerpAPI Key (OPTIONAL - for web search)

1. Go to: https://serpapi.com/
2. Sign up
3. Copy API key from dashboard
4. Free tier: 100 searches/month

---

## Step 6: Configure Environment

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` in a text editor

3. Add your keys:

   ```
   ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
   TELEGRAM_BOT_TOKEN=1234567890:your-actual-token-here
   SERPAPI_KEY=your-serpapi-key-here
   ```

4. Save the file

---

## Step 7: Test Everything

Run the test script:

```bash
python test_setup.py
```

You should see:

```
✓ Environment variables set
✓ All imports successful
✓ Calculator works
✓ Weather tool works
✓ File operations work
✓ Code execution works
```

---

## Step 8: Run the Bot!

```bash
python main.py
```

You should see:

```
INFO - Starting AI Agent MVP...
INFO - Bot is starting...
INFO - Press Ctrl+C to stop
```

---

## Step 9: Test on Telegram

1. Open Telegram app
2. Search for your bot username (from @BotFather)
3. Click "Start" or send `/start`
4. Try: "What's the weather in Tokyo?"

---

## Troubleshooting

### "No module named 'agent'"

**Problem:** Files not in correct folders

**Solution:** Check your folder structure matches Step 3 exactly

### "ANTHROPIC_API_KEY not found"

**Problem:** `.env` file missing or incorrect

**Solution:**

1. Make sure you renamed `.env.example` to `.env`
2. Check the file is in the `mvp-agent/` folder (same folder as `main.py`)
3. Verify your API key is correct

### "ModuleNotFoundError: No module named 'telegram'"

**Problem:** Dependencies not installed

**Solution:**

```bash
pip install -r requirements.txt
```

### Bot doesn't respond on Telegram

**Problem:** Bot token incorrect or bot not started

**Solution:**

1. Verify token from @BotFather
2. Make sure you sent `/start` to the bot first
3. Check terminal for error messages

---

## Quick Reference: File Contents

If you need to manually create files, here's what each does:

### Root Files:

- **main.py** - Starts the bot, checks environment
- **requirements.txt** - List of Python packages to install
- **.env** - Your secret API keys (YOU create this from .env.example)
- **test_setup.py** - Tests everything is working

### agent/ Files:

- ****init**.py** - Makes agent a Python package
- **memory.py** - Stores conversation history (in-memory for MVP)
- **llm_interface.py** - Talks to Claude API
- **orchestrator.py** - Main brain - decides what to do

### tools/ Files:

- ****init**.py** - Registers all tools
- **weather.py** - Gets weather from wttr.in
- **web_search.py** - Searches web via SerpAPI
- **calculator.py** - Does math calculations
- **file_ops.py** - Reads/writes files in sandbox
- **code_exec.py** - Runs Python code safely

### telegram_bot/ Files:

- ****init**.py** - Makes telegram_bot a Python package
- **bot.py** - Receives messages from Telegram, sends responses

---

## Still Having Issues?

1. Double-check folder structure (Step 3)
2. Make sure ALL files are copied
3. Verify `.env` file exists with your actual keys
4. Run `python test_setup.py` to see specific errors
5. Check Python version: `python --version` (should be 3.11+)

---

## Success Checklist

✅ Created folder structure
✅ Downloaded all 18 files
✅ Placed files in correct folders
✅ Installed dependencies (`pip install -r requirements.txt`)
✅ Got API keys (Anthropic + Telegram)
✅ Created `.env` file with keys
✅ Ran `python test_setup.py` successfully
✅ Started bot with `python main.py`
✅ Bot responds on Telegram

If all checkboxes are done, you're ready to go! 🚀
