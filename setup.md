#!/bin/bash

# Setup script for Telegram AI Agent MVP

echo "🤖 Setting up Telegram AI Agent MVP"
echo "======================================"
echo ""

# Check if Python 3.11+ is installed

if ! command -v python3 &> /dev/null; then
echo "❌ Python 3 is not installed. Please install Python 3.11 or higher."
exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d " " -f 2 | cut -d "." -f 1,2)
echo "✅ Python version: $PYTHON_VERSION"

# Create virtual environment

echo ""
echo "📦 Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment

echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip

echo "⬆️ Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1

# Install dependencies

echo "📥 Installing dependencies..."
pip install -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Copy .env.example to .env"
echo " cp .env.example .env"
echo ""
echo "2. Edit .env and add your API keys:"
echo " - Get Telegram bot token from @BotFather"
echo " - Get Anthropic API key from https://console.anthropic.com/"
echo " - (Optional) Get SerpAPI key from https://serpapi.com/"
echo ""
echo "3. Activate the virtual environment:"
echo " source venv/bin/activate"
echo ""
echo "4. Run the bot:"
echo " python main.py"
echo ""
