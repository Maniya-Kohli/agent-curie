"""
Web search tool - Search the web using SerpAPI.
Falls back to graceful error if no API key is provided.
"""

import os
import requests
from typing import Dict, Optional


def web_search(query: str, num_results: int = 5) -> str:
    """
    Search the web for information.
    
    Args:
        query: Search query
        num_results: Number of results to return (default: 5)
    
    Returns:
        Search results as formatted string
    """
    api_key = os.getenv("SERPAPI_KEY")
    
    if not api_key:
        return ("Web search is not configured. To enable web search, please set SERPAPI_KEY "
                "environment variable. Get a free key at https://serpapi.com/")
    
    try:
        url = "https://serpapi.com/search"
        
        params = {
            "q": query,
            "api_key": api_key,
            "engine": "google",
            "num": num_results,
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        # Check for errors
        if "error" in data:
            return f"Search error: {data['error']}"
        
        # Extract organic results
        organic_results = data.get("organic_results", [])
        
        if not organic_results:
            return f"No results found for query: {query}"
        
        # Format results
        results_text = f"Search results for '{query}':\n\n"
        
        for i, result in enumerate(organic_results[:num_results], 1):
            title = result.get("title", "No title")
            link = result.get("link", "")
            snippet = result.get("snippet", "No description")
            
            results_text += f"{i}. {title}\n"
            results_text += f"   {snippet}\n"
            results_text += f"   🔗 {link}\n\n"
        
        return results_text.strip()
        
    except requests.exceptions.Timeout:
        return "Search request timed out. Please try again."
    
    except requests.exceptions.RequestException as e:
        return f"Error performing search: {str(e)}"
    
    except Exception as e:
        return f"Unexpected error during search: {str(e)}"


# Tool definition for Claude API
WEB_SEARCH_TOOL: Dict = {
    "name": "web_search",
    "description": "Search the web for current information, news, facts, or any online content. Returns top search results with titles, snippets, and links.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up on the web"
            },
            "num_results": {
                "type": "integer",
                "description": "Number of search results to return (default: 5, max: 10)",
                "default": 5
            }
        },
        "required": ["query"]
    }
}