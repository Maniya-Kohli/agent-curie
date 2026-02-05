"""
LLM Interface - Wrapper around Anthropic Claude API.
Handles API calls, retries, and error handling.
"""

import os
from typing import List, Dict, Optional
import anthropic
from anthropic.types import MessageParam, ToolParam
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class LLMInterface:
    """Interface to Claude API with retry logic and error handling."""
    
    def __init__(self, api_key: Optional[str] = None, model: str = "claude-sonnet-4-5-20250929"):
        """
        Initialize LLM interface.
        
        Args:
            api_key: Anthropic API key (or uses ANTHROPIC_API_KEY env var)
            model: Model to use
        """
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not found in environment or parameters")
        
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = model
        self.max_retries = 3
        self.retry_delay = 1  # seconds
    
    async def complete(
        self,
        messages: List[MessageParam],
        tools: Optional[List[ToolParam]] = None,
        max_tokens: int = 4096,
        temperature: float = 1.0,
        system: Optional[str] = None
    ) -> anthropic.types.Message:
        """
        Send a completion request to Claude.
        
        Args:
            messages: List of message dictionaries
            tools: List of available tools
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature
            system: System prompt
        
        Returns:
            Claude API response
        """
        for attempt in range(self.max_retries):
            try:
                kwargs = {
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "messages": messages,
                    "temperature": temperature,
                }
                
                if tools:
                    kwargs["tools"] = tools
                
                if system:
                    kwargs["system"] = system
                
                logger.info(f"Calling Claude API (attempt {attempt + 1}/{self.max_retries})")
                
                response = self.client.messages.create(**kwargs)
                
                logger.info(f"API call successful. Stop reason: {response.stop_reason}")
                
                return response
                
            except anthropic.RateLimitError as e:
                logger.warning(f"Rate limit hit: {e}")
                if attempt < self.max_retries - 1:
                    wait_time = self.retry_delay * (2 ** attempt)  # Exponential backoff
                    logger.info(f"Waiting {wait_time}s before retry...")
                    time.sleep(wait_time)
                else:
                    raise
            
            except anthropic.APIError as e:
                logger.error(f"API error: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay)
                else:
                    raise
            
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                raise
        
        raise Exception("Max retries exceeded")
    
    def count_tokens(self, text: str) -> int:
        """
        Estimate token count (rough approximation).
        
        Args:
            text: Text to count tokens for
        
        Returns:
            Estimated token count
        """
        # Rough estimate: ~4 characters per token
        return len(text) // 4
    
    def get_model_info(self) -> Dict:
        """Get information about the current model."""
        return {
            "model": self.model,
            "provider": "anthropic",
            "max_tokens": 200000,  # Claude 3.5 context window
            "supports_tools": True,
            "supports_vision": True,
        }