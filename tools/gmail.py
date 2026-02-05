"""
Gmail tool - Send and read emails using Gmail API.
"""

import os
import base64
import pickle
from email.mime.text import MIMEText
from typing import Dict, Optional
from datetime import datetime

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GMAIL_AVAILABLE = True
except ImportError:
    GMAIL_AVAILABLE = False


# Gmail API scopes
SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose'
]

TOKEN_FILE = 'token.pickle'
CREDENTIALS_FILE = os.getenv('GOOGLE_CREDENTIALS_FILE', 'credentials.json')


def get_gmail_service():
    """Authenticate and return Gmail service."""
    if not GMAIL_AVAILABLE:
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
    
    return build('gmail', 'v1', credentials=creds)


def send_email(to: str, subject: str, body: str, cc: Optional[str] = None) -> str:
    """
    Send an email via Gmail.
    
    Args:
        to: Recipient email address
        subject: Email subject
        body: Email body text
        cc: CC recipients (optional)
    
    Returns:
        Success or error message
    """
    if not GMAIL_AVAILABLE:
        return ("Gmail integration not available. Install required packages:\n"
                "pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")
    
    try:
        service = get_gmail_service()
        if not service:
            return ("Gmail not configured. Please:\n"
                    "1. Download credentials.json from Google Cloud Console\n"
                    "2. Place it in project root\n"
                    "3. See GOOGLE_SETUP.md for instructions")
        
        # Create message
        message = MIMEText(body)
        message['to'] = to
        message['subject'] = subject
        
        if cc:
            message['cc'] = cc
        
        # Encode message
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        
        # Send
        send_message = {'raw': raw_message}
        result = service.users().messages().send(
            userId='me',
            body=send_message
        ).execute()
        
        return f"✅ Email sent successfully!\nMessage ID: {result['id']}\nTo: {to}\nSubject: {subject}"
        
    except HttpError as e:
        return f"Gmail API error: {str(e)}"
    except Exception as e:
        return f"Error sending email: {str(e)}"


def read_emails(max_results: int = 5, query: Optional[str] = None) -> str:
    """
    Read recent emails from Gmail.
    
    Args:
        max_results: Number of emails to retrieve (default: 5)
        query: Search query (e.g., "from:john@example.com", "subject:invoice")
    
    Returns:
        Formatted list of emails
    """
    if not GMAIL_AVAILABLE:
        return ("Gmail integration not available. Install required packages:\n"
                "pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")
    
    try:
        service = get_gmail_service()
        if not service:
            return ("Gmail not configured. Please:\n"
                    "1. Download credentials.json from Google Cloud Console\n"
                    "2. Place it in project root\n"
                    "3. See GOOGLE_SETUP.md for instructions")
        
        # Get messages
        results = service.users().messages().list(
            userId='me',
            maxResults=max_results,
            q=query if query else ''
        ).execute()
        
        messages = results.get('messages', [])
        
        if not messages:
            return "No emails found." if not query else f"No emails found matching: {query}"
        
        # Format output
        output = f"📧 {'Recent emails' if not query else f'Emails matching: {query}'} (showing {len(messages)}):\n\n"
        
        for i, msg in enumerate(messages, 1):
            # Get full message
            message = service.users().messages().get(
                userId='me',
                id=msg['id'],
                format='full'
            ).execute()
            
            # Extract headers
            headers = message['payload']['headers']
            subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), 'No Subject')
            from_email = next((h['value'] for h in headers if h['name'].lower() == 'from'), 'Unknown')
            date = next((h['value'] for h in headers if h['name'].lower() == 'date'), 'Unknown')
            
            # Get snippet
            snippet = message.get('snippet', '')
            
            output += f"{i}. From: {from_email}\n"
            output += f"   Subject: {subject}\n"
            output += f"   Date: {date}\n"
            output += f"   Preview: {snippet[:100]}...\n\n"
        
        return output.strip()
        
    except HttpError as e:
        return f"Gmail API error: {str(e)}"
    except Exception as e:
        return f"Error reading emails: {str(e)}"


def search_emails(query: str, max_results: int = 10) -> str:
    """
    Search emails in Gmail.
    
    Args:
        query: Search query (e.g., "from:john@example.com", "subject:invoice")
        max_results: Maximum number of results
    
    Returns:
        Search results
    """
    return read_emails(max_results=max_results, query=query)


# Tool definitions for Claude API
SEND_EMAIL_TOOL: Dict = {
    "name": "send_email",
    "description": "Send an email via Gmail. Can send to one or multiple recipients, with optional CC.",
    "input_schema": {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address (e.g., 'john@example.com')"
            },
            "subject": {
                "type": "string",
                "description": "Email subject line"
            },
            "body": {
                "type": "string",
                "description": "Email body text/content"
            },
            "cc": {
                "type": "string",
                "description": "Optional CC recipients (comma-separated)"
            }
        },
        "required": ["to", "subject", "body"]
    }
}

READ_EMAILS_TOOL: Dict = {
    "name": "read_emails",
    "description": "Read recent emails from Gmail inbox. Can retrieve up to 20 recent emails.",
    "input_schema": {
        "type": "object",
        "properties": {
            "max_results": {
                "type": "integer",
                "description": "Number of emails to retrieve (1-20, default: 5)",
                "default": 5
            },
            "query": {
                "type": "string",
                "description": "Optional search query to filter emails (e.g., 'from:john@example.com', 'subject:meeting')"
            }
        },
        "required": []
    }
}

SEARCH_EMAILS_TOOL: Dict = {
    "name": "search_emails",
    "description": "Search for specific emails in Gmail using search queries. Supports Gmail search operators like 'from:', 'to:', 'subject:', 'has:attachment', date ranges, etc.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Gmail search query (e.g., 'from:john@example.com', 'subject:invoice', 'has:attachment')"
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return (1-20, default: 10)",
                "default": 10
            }
        },
        "required": ["query"]
    }
}