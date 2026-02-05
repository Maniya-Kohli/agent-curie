"""
Telegram bot handler - Interface between Telegram and the agent.
"""

import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from agent import orchestrator, memory

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    user = update.effective_user
    user_id = str(user.id)
    
    welcome_message = f"""👋 Hello {user.first_name}!

I'm an AI agent powered by Claude. I can help you with:

🌤️ **Weather** - "What's the weather in Tokyo?"
🔍 **Web Search** - "Search for latest AI news"
🧮 **Calculations** - "Calculate 15% tip on $87.50"
📁 **Files** - "Write a Python script to hello.py"
💻 **Code** - "Execute: print('Hello World')"

Just send me a message and I'll do my best to help!

Available commands:
/start - Show this message
/clear - Clear conversation history
/stats - Show bot statistics
"""
    
    await update.message.reply_text(welcome_message)


async def clear_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /clear command - clear conversation history."""
    user_id = str(update.effective_user.id)
    memory.clear_conversation(user_id)
    
    await update.message.reply_text("✅ Conversation history cleared!")


async def stats_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /stats command - show bot statistics."""
    stats = orchestrator.get_stats()
    
    stats_message = f"""📊 **Bot Statistics**

🤖 Model: {stats['model']}
👥 Total users: {stats['total_users']}
💬 Total messages: {stats['total_messages']}
"""
    
    await update.message.reply_text(stats_message)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle regular messages from users."""
    user = update.effective_user
    user_id = str(user.id)
    message_text = update.message.text
    
    logger.info(f"Received message from {user.first_name} ({user_id}): {message_text[:50]}...")
    
    # Show typing indicator
    await update.message.chat.send_action("typing")
    
    try:
        # Process message with agent
        response = await orchestrator.process_message(user_id, message_text)
        
        # Send response (split if too long for Telegram)
        if len(response) <= 4096:
            await update.message.reply_text(response)
        else:
            # Split into chunks
            chunks = [response[i:i+4096] for i in range(0, len(response), 4096)]
            for chunk in chunks:
                await update.message.reply_text(chunk)
        
    except Exception as e:
        logger.error(f"Error handling message: {e}", exc_info=True)
        await update.message.reply_text(
            "❌ Sorry, I encountered an error processing your message. Please try again."
        )


async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle errors."""
    logger.error(f"Update {update} caused error {context.error}", exc_info=context.error)


def create_bot(token: str) -> Application:
    """
    Create and configure the Telegram bot.
    
    Args:
        token: Telegram bot token
    
    Returns:
        Configured application
    """
    # Create application
    application = Application.builder().token(token).build()
    
    # Add command handlers
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("clear", clear_command))
    application.add_handler(CommandHandler("stats", stats_command))
    
    # Add message handler
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    # Add error handler
    application.add_error_handler(error_handler)
    
    logger.info("Bot created and configured")
    
    return application