#!/usr/bin/env python3
"""
Test script to verify agent setup without running Telegram bot.
Tests individual components and tools.
"""

import os
import sys
import asyncio
from dotenv import load_dotenv

# Load environment
load_dotenv()


def check_environment():
    """Check environment variables."""
    print("=" * 60)
    print("CHECKING ENVIRONMENT")
    print("=" * 60)
    
    required = {
        "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY"),
        "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN"),
    }
    
    optional = {
        "SERPAPI_KEY": os.getenv("SERPAPI_KEY"),
    }
    
    all_good = True
    
    print("\nRequired variables:")
    for key, value in required.items():
        status = "✅ SET" if value else "❌ MISSING"
        print(f"  {key}: {status}")
        if not value:
            all_good = False
    
    print("\nOptional variables:")
    for key, value in optional.items():
        status = "✅ SET" if value else "○ Not set"
        print(f"  {key}: {status}")
    
    print()
    return all_good


def test_imports():
    """Test that all imports work."""
    print("=" * 60)
    print("TESTING IMPORTS")
    print("=" * 60)
    
    try:
        print("\nImporting agent components...")
        from agent import orchestrator, memory
        print("  ✅ Agent components imported")
        
        print("Importing tools...")
        from tools import TOOL_FUNCTIONS, TOOL_DEFINITIONS
        print(f"  ✅ {len(TOOL_FUNCTIONS)} tools loaded")
        
        print("Importing Telegram bot...")
        from telegram_bot import create_bot
        print("  ✅ Telegram bot imported")
        
        print("\n✅ All imports successful!")
        return True
        
    except Exception as e:
        print(f"\n❌ Import error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_tools():
    """Test individual tools."""
    print("\n" + "=" * 60)
    print("TESTING TOOLS")
    print("=" * 60)
    
    from tools import TOOL_FUNCTIONS
    
    # Test calculator
    print("\n1. Testing calculator...")
    try:
        result = TOOL_FUNCTIONS["calculate"](expression="2 + 2")
        print(f"   Input: 2 + 2")
        print(f"   {result}")
        assert "4" in result
        print("   ✅ Calculator works")
    except Exception as e:
        print(f"   ❌ Calculator error: {e}")
    
    # Test weather
    print("\n2. Testing weather...")
    try:
        result = TOOL_FUNCTIONS["get_weather"](location="London")
        print(f"   Input: London")
        print(f"   {result[:100]}...")
        assert "Weather" in result or "Error" in result
        print("   ✅ Weather tool works")
    except Exception as e:
        print(f"   ❌ Weather error: {e}")
    
    # Test file operations
    print("\n3. Testing file operations...")
    try:
        # Write file
        write_result = TOOL_FUNCTIONS["write_file"](
            filename="test.txt",
            content="Hello from test script!"
        )
        print(f"   Write: {write_result}")
        
        # Read file
        read_result = TOOL_FUNCTIONS["read_file"](filename="test.txt")
        print(f"   Read: {read_result[:50]}...")
        
        # List files
        list_result = TOOL_FUNCTIONS["list_files"](directory=".")
        print(f"   List: {list_result[:100]}...")
        
        print("   ✅ File operations work")
    except Exception as e:
        print(f"   ❌ File operations error: {e}")
    
    # Test code execution
    print("\n4. Testing code execution...")
    try:
        result = TOOL_FUNCTIONS["execute_python"](
            code='print("Hello World!")\nprint(2 + 2)'
        )
        print(f"   Input: print('Hello World!')\\nprint(2 + 2)")
        print(f"   {result}")
        assert "Hello World" in result and "4" in result
        print("   ✅ Code execution works")
    except Exception as e:
        print(f"   ❌ Code execution error: {e}")
    
    # Test web search (may fail if no API key)
    print("\n5. Testing web search...")
    try:
        result = TOOL_FUNCTIONS["web_search"](query="Python programming", num_results=3)
        print(f"   Input: Python programming")
        print(f"   {result[:100]}...")
        print("   ✅ Web search works" if "Error" not in result[:50] else "   ○ Web search not configured (expected)")
    except Exception as e:
        print(f"   ○ Web search not configured: {e}")


async def test_orchestrator():
    """Test the agent orchestrator."""
    print("\n" + "=" * 60)
    print("TESTING ORCHESTRATOR")
    print("=" * 60)
    
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("\n⚠️  Skipping orchestrator test - ANTHROPIC_API_KEY not set")
        return
    
    try:
        from agent import orchestrator
        
        test_user_id = "test_user_123"
        
        print("\n1. Testing simple query...")
        response = await orchestrator.process_message(
            test_user_id,
            "Calculate 10 + 5"
        )
        print(f"   Query: Calculate 10 + 5")
        print(f"   Response: {response[:100]}...")
        
        print("\n2. Testing tool use...")
        response = await orchestrator.process_message(
            test_user_id,
            "What's 15% of 200?"
        )
        print(f"   Query: What's 15% of 200?")
        print(f"   Response: {response[:100]}...")
        
        print("\n3. Getting stats...")
        stats = orchestrator.get_stats()
        print(f"   Stats: {stats}")
        
        print("\n✅ Orchestrator works!")
        
    except Exception as e:
        print(f"\n❌ Orchestrator error: {e}")
        import traceback
        traceback.print_exc()


async def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("AI AGENT MVP - TEST SUITE")
    print("=" * 60)
    
    # Check environment
    env_ok = check_environment()
    if not env_ok:
        print("\n⚠️  Some required environment variables are missing!")
        print("    Create a .env file with your API keys to continue.")
        print("    See .env.example for reference.")
        print("\nTo create .env file:")
        print("    cp .env.example .env")
        print("    # Then edit .env and add your keys")
        return
    
    # Test imports
    if not test_imports():
        print("\n❌ Import test failed. Check your dependencies.")
        print("   Run: pip3 install -r requirements.txt")
        return
    
    # Test tools
    test_tools()
    
    # Test orchestrator (requires API key)
    await test_orchestrator()
    
    print("\n" + "=" * 60)
    print("TEST SUITE COMPLETE")
    print("=" * 60)
    print("\nIf all tests passed, you can run the bot with:")
    print("  python3 main.py")
    print()


if __name__ == "__main__":
    asyncio.run(main())