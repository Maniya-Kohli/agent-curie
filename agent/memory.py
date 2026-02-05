"""
In-memory state management for conversations.
Stores conversation history per user.
"""

from typing import Dict, List
from datetime import datetime


class ConversationMemory:
    """Simple in-memory conversation storage."""
    
    def __init__(self, max_messages_per_user: int = 50):
        """
        Initialize memory storage.
        
        Args:
            max_messages_per_user: Maximum messages to keep per user
        """
        self.conversations: Dict[str, List[Dict]] = {}
        self.max_messages = max_messages_per_user
        self.user_metadata: Dict[str, Dict] = {}
    
    def add_message(self, user_id: str, role: str, content: str) -> None:
        """
        Add a message to conversation history.
        
        Args:
            user_id: Unique user identifier
            role: Message role (user/assistant)
            content: Message content
        """
        if user_id not in self.conversations:
            self.conversations[user_id] = []
        
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        }
        
        self.conversations[user_id].append(message)
        
        # Trim old messages if exceeding limit
        if len(self.conversations[user_id]) > self.max_messages:
            # Keep last max_messages
            self.conversations[user_id] = self.conversations[user_id][-self.max_messages:]
    
    def get_conversation(self, user_id: str, last_n: int = None) -> List[Dict]:
        """
        Get conversation history for a user.
        
        Args:
            user_id: Unique user identifier
            last_n: Number of recent messages to retrieve (None = all)
        
        Returns:
            List of message dictionaries
        """
        if user_id not in self.conversations:
            return []
        
        messages = self.conversations[user_id]
        
        if last_n is not None:
            return messages[-last_n:]
        
        return messages
    
    def get_messages_for_llm(self, user_id: str, last_n: int = 20) -> List[Dict]:
        """
        Get conversation formatted for LLM API (without timestamps).
        
        Args:
            user_id: Unique user identifier
            last_n: Number of recent messages to include
        
        Returns:
            List of messages formatted for LLM
        """
        messages = self.get_conversation(user_id, last_n)
        
        # Remove timestamps and format for LLM
        return [
            {"role": msg["role"], "content": msg["content"]}
            for msg in messages
        ]
    
    def clear_conversation(self, user_id: str) -> None:
        """Clear conversation history for a user."""
        if user_id in self.conversations:
            self.conversations[user_id] = []
    
    def set_user_metadata(self, user_id: str, key: str, value: any) -> None:
        """Store user-specific metadata."""
        if user_id not in self.user_metadata:
            self.user_metadata[user_id] = {}
        
        self.user_metadata[user_id][key] = value
    
    def get_user_metadata(self, user_id: str, key: str, default=None) -> any:
        """Retrieve user-specific metadata."""
        if user_id not in self.user_metadata:
            return default
        
        return self.user_metadata[user_id].get(key, default)
    
    def get_stats(self) -> Dict:
        """Get memory statistics."""
        return {
            "total_users": len(self.conversations),
            "total_messages": sum(len(msgs) for msgs in self.conversations.values()),
            "users": list(self.conversations.keys())
        }


# Global instance
memory = ConversationMemory()