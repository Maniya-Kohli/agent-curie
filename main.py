"""
Main entry point for the AI Agent MVP.
"""

import os
import sys
import logging
from dotenv import load_dotenv

# Load environment variables FIRST before any other imports
load_dotenv()

# Now import after env is loaded
from telegram_bot import create_bot
from telegram import Update

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


def check_environment():
    """Check if all required environment variables are set."""
    required_vars = {
        "ANTHROPIC_API_KEY": "Get from https://console.anthropic.com/",
        "TELEGRAM_BOT_TOKEN": "Get from @BotFather on Telegram"
    }
    
    missing_vars = []
    for var, instruction in required_vars.items():
        if not os.getenv(var):
            missing_vars.append(f"  - {var}: {instruction}")
    
    if missing_vars:
        logger.error("Missing required environment variables:")
        for var in missing_vars:
            logger.error(var)
        logger.error("\nPlease set these in your .env file or as environment variables.")
        return False
    
    # Optional variables
    if not os.getenv("SERPAPI_KEY"):
        logger.warning("SERPAPI_KEY not set - web search will be disabled")
        logger.warning("Get a free key from https://serpapi.com/")
    
    return True


def main():
    """Main function to start the bot."""
    logger.info("Starting AI Agent MVP...")
    
    # Check environment
    if not check_environment():
        sys.exit(1)
    
    # Get bot token
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    
    try:
        # Create bot
        logger.info("Creating Telegram bot...")
        application = create_bot(bot_token)
        
        # Start bot
        logger.info("Bot is starting...")
        logger.info("Press Ctrl+C to stop")
        
        # Run the bot
        application.run_polling(allowed_updates=Update.ALL_TYPES)
        
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()