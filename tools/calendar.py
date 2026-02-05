"""
Google Calendar tool - Manage calendar events.
"""

import os
import pickle
from typing import Dict, Optional
from datetime import datetime, timedelta
import dateutil.parser

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    CALENDAR_AVAILABLE = True
except ImportError:
    CALENDAR_AVAILABLE = False


# Calendar API scopes
SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
]

TOKEN_FILE = 'token.pickle'
CREDENTIALS_FILE = os.getenv('GOOGLE_CREDENTIALS_FILE', 'credentials.json')


def get_calendar_service():
    """Authenticate and return Calendar service."""
    if not CALENDAR_AVAILABLE:
        return None
    
    creds = None
    
    # Load saved credentials
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            creds = pickle.load(token)
    
    # If no valid credentials, authenticate
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                return None
            
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save credentials
        with open(TOKEN_FILE, 'wb') as token:
            pickle.dump(creds, token)
    
    return build('calendar', 'v3', credentials=creds)


def parse_datetime(date_str: str) -> datetime:
    """Parse flexible date/time strings."""
    # Try common formats
    try:
        return dateutil.parser.parse(date_str)
    except:
        # Handle relative dates
        lower = date_str.lower()
        now = datetime.now()
        
        if 'today' in lower:
            return now.replace(hour=9, minute=0, second=0)
        elif 'tomorrow' in lower:
            return (now + timedelta(days=1)).replace(hour=9, minute=0, second=0)
        elif 'next week' in lower:
            return (now + timedelta(weeks=1)).replace(hour=9, minute=0, second=0)
        else:
            return now


def create_event(
    title: str,
    start_time: str,
    duration_minutes: int = 60,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendees: Optional[str] = None
) -> str:
    """
    Create a calendar event.
    
    Args:
        title: Event title
        start_time: Start time (e.g., "2024-03-20 14:00", "tomorrow at 2pm")
        duration_minutes: Event duration in minutes (default: 60)
        description: Event description (optional)
        location: Event location (optional)
        attendees: Comma-separated email addresses (optional)
    
    Returns:
        Success or error message
    """
    if not CALENDAR_AVAILABLE:
        return ("Calendar integration not available. Install required packages:\n"
                "pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client python-dateutil")
    
    try:
        service = get_calendar_service()
        if not service:
            return ("Calendar not configured. Please:\n"
                    "1. Download credentials.json from Google Cloud Console\n"
                    "2. Place it in project root\n"
                    "3. See GOOGLE_SETUP.md for instructions")
        
        # Parse start time
        start_dt = parse_datetime(start_time)
        end_dt = start_dt + timedelta(minutes=duration_minutes)
        
        # Build event
        event = {
            'summary': title,
            'start': {
                'dateTime': start_dt.isoformat(),
                'timeZone': 'America/Los_Angeles',  # Adjust to user's timezone
            },
            'end': {
                'dateTime': end_dt.isoformat(),
                'timeZone': 'America/Los_Angeles',
            },
        }
        
        if description:
            event['description'] = description
        
        if location:
            event['location'] = location
        
        if attendees:
            event['attendees'] = [{'email': email.strip()} for email in attendees.split(',')]
        
        # Create event
        created_event = service.events().insert(calendarId='primary', body=event).execute()
        
        result = f"✅ Event created successfully!\n"
        result += f"📅 {title}\n"
        result += f"🕐 {start_dt.strftime('%Y-%m-%d %I:%M %p')} - {end_dt.strftime('%I:%M %p')}\n"
        if location:
            result += f"📍 {location}\n"
        result += f"\n🔗 {created_event.get('htmlLink', 'N/A')}"
        
        return result
        
    except HttpError as e:
        return f"Calendar API error: {str(e)}"
    except Exception as e:
        return f"Error creating event: {str(e)}"


def view_events(days_ahead: int = 7, max_results: int = 10) -> str:
    """
    View upcoming calendar events.
    
    Args:
        days_ahead: Number of days to look ahead (default: 7)
        max_results: Maximum number of events to show (default: 10)
    
    Returns:
        Formatted list of events
    """
    if not CALENDAR_AVAILABLE:
        return ("Calendar integration not available. Install required packages:\n"
                "pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client python-dateutil")
    
    try:
        service = get_calendar_service()
        if not service:
            return ("Calendar not configured. Please:\n"
                    "1. Download credentials.json from Google Cloud Console\n"
                    "2. Place it in project root\n"
                    "3. See GOOGLE_SETUP.md for instructions")
        
        # Get events
        now = datetime.utcnow()
        time_min = now.isoformat() + 'Z'
        time_max = (now + timedelta(days=days_ahead)).isoformat() + 'Z'
        
        events_result = service.events().list(
            calendarId='primary',
            timeMin=time_min,
            timeMax=time_max,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])
        
        if not events:
            return f"No events found in the next {days_ahead} days."
        
        # Format output
        output = f"📅 Upcoming events (next {days_ahead} days):\n\n"
        
        for i, event in enumerate(events, 1):
            start = event['start'].get('dateTime', event['start'].get('date'))
            start_dt = dateutil.parser.parse(start)
            
            output += f"{i}. {event['summary']}\n"
            output += f"   🕐 {start_dt.strftime('%A, %B %d at %I:%M %p')}\n"
            
            if 'location' in event:
                output += f"   📍 {event['location']}\n"
            
            if 'description' in event:
                desc = event['description'][:100]
                output += f"   📝 {desc}...\n"
            
            output += "\n"
        
        return output.strip()
        
    except HttpError as e:
        return f"Calendar API error: {str(e)}"
    except Exception as e:
        return f"Error viewing events: {str(e)}"


def check_availability(date_time: str, duration_minutes: int = 60) -> str:
    """
    Check if a time slot is available.
    
    Args:
        date_time: Date and time to check (e.g., "2024-03-20 14:00", "tomorrow at 2pm")
        duration_minutes: Duration to check (default: 60)
    
    Returns:
        Availability status
    """
    if not CALENDAR_AVAILABLE:
        return ("Calendar integration not available. Install required packages:\n"
                "pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client python-dateutil")
    
    try:
        service = get_calendar_service()
        if not service:
            return ("Calendar not configured. Please:\n"
                    "1. Download credentials.json from Google Cloud Console\n"
                    "2. Place it in project root\n"
                    "3. See GOOGLE_SETUP.md for instructions")
        
        # Parse time
        check_dt = parse_datetime(date_time)
        end_dt = check_dt + timedelta(minutes=duration_minutes)
        
        # Get events in that time range
        events_result = service.events().list(
            calendarId='primary',
            timeMin=check_dt.isoformat() + 'Z',
            timeMax=end_dt.isoformat() + 'Z',
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])
        
        if not events:
            return (f"✅ You're free!\n"
                    f"📅 {check_dt.strftime('%A, %B %d at %I:%M %p')}\n"
                    f"⏱️ For {duration_minutes} minutes")
        else:
            conflicts = "\n".join([f"   • {e['summary']}" for e in events])
            return (f"❌ Conflict found:\n"
                    f"📅 {check_dt.strftime('%A, %B %d at %I:%M %p')}\n"
                    f"Conflicts with:\n{conflicts}")
        
    except HttpError as e:
        return f"Calendar API error: {str(e)}"
    except Exception as e:
        return f"Error checking availability: {str(e)}"


# Tool definitions for Claude API
CREATE_EVENT_TOOL: Dict = {
    "name": "create_event",
    "description": "Create a new calendar event in Google Calendar. Can specify title, time, duration, location, and attendees.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Event title/name"
            },
            "start_time": {
                "type": "string",
                "description": "Start time (flexible formats: '2024-03-20 14:00', 'tomorrow at 2pm', 'next Monday at 9am')"
            },
            "duration_minutes": {
                "type": "integer",
                "description": "Event duration in minutes (default: 60)",
                "default": 60
            },
            "description": {
                "type": "string",
                "description": "Event description/notes (optional)"
            },
            "location": {
                "type": "string",
                "description": "Event location (optional)"
            },
            "attendees": {
                "type": "string",
                "description": "Comma-separated email addresses of attendees (optional)"
            }
        },
        "required": ["title", "start_time"]
    }
}

VIEW_EVENTS_TOOL: Dict = {
    "name": "view_events",
    "description": "View upcoming events from Google Calendar. Shows events for the next 7 days by default.",
    "input_schema": {
        "type": "object",
        "properties": {
            "days_ahead": {
                "type": "integer",
                "description": "Number of days to look ahead (default: 7)",
                "default": 7
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of events to show (default: 10)",
                "default": 10
            }
        },
        "required": []
    }
}

CHECK_AVAILABILITY_TOOL: Dict = {
    "name": "check_availability",
    "description": "Check if a specific time slot is available in the calendar. Useful for scheduling meetings.",
    "input_schema": {
        "type": "object",
        "properties": {
            "date_time": {
                "type": "string",
                "description": "Date and time to check (e.g., '2024-03-20 14:00', 'tomorrow at 2pm', 'Friday at 3pm')"
            },
            "duration_minutes": {
                "type": "integer",
                "description": "Duration to check in minutes (default: 60)",
                "default": 60
            }
        },
        "required": ["date_time"]
    }
}