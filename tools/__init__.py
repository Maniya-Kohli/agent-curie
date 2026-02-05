"""
Tools package - All available tools for the agent.
"""

from .weather import get_weather, WEATHER_TOOL
from .web_search import web_search, WEB_SEARCH_TOOL
from .calculator import calculate, CALCULATOR_TOOL
from .file_ops import read_file, write_file, list_files, READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL
from .code_exec import execute_python, PYTHON_EXEC_TOOL
from .gmail import send_email, read_emails, search_emails, SEND_EMAIL_TOOL, READ_EMAILS_TOOL, SEARCH_EMAILS_TOOL
from .calendar import create_event, view_events, check_availability, CREATE_EVENT_TOOL, VIEW_EVENTS_TOOL, CHECK_AVAILABILITY_TOOL


# All tool functions
TOOL_FUNCTIONS = {
    # Original tools (7)
    "get_weather": get_weather,
    "web_search": web_search,
    "calculate": calculate,
    "read_file": read_file,
    "write_file": write_file,
    "list_files": list_files,
    "execute_python": execute_python,
    
    # Gmail tools (3)
    "send_email": send_email,
    "read_emails": read_emails,
    "search_emails": search_emails,
    
    # Calendar tools (3)
    "create_event": create_event,
    "view_events": view_events,
    "check_availability": check_availability,
}

# All tool definitions for Claude API
TOOL_DEFINITIONS = [
    # Original tools (7)
    WEATHER_TOOL,
    WEB_SEARCH_TOOL,
    CALCULATOR_TOOL,
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    LIST_FILES_TOOL,
    PYTHON_EXEC_TOOL,
    
    # Gmail tools (3)
    SEND_EMAIL_TOOL,
    READ_EMAILS_TOOL,
    SEARCH_EMAILS_TOOL,
    
    # Calendar tools (3)
    CREATE_EVENT_TOOL,
    VIEW_EVENTS_TOOL,
    CHECK_AVAILABILITY_TOOL,
]


__all__ = [
    'TOOL_FUNCTIONS',
    'TOOL_DEFINITIONS',
    # Original tools
    'get_weather',
    'web_search',
    'calculate',
    'read_file',
    'write_file',
    'list_files',
    'execute_python',
    # Gmail tools
    'send_email',
    'read_emails',
    'search_emails',
    # Calendar tools
    'create_event',
    'view_events',
    'check_availability',
]