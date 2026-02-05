"""
Weather tool - Get current weather for any location.
Uses wttr.in API (no API key required).
"""

import requests
from typing import Dict


def get_weather(location: str) -> str:
    """
    Get current weather for a location.
    
    Args:
        location: City name or location (e.g., "Paris", "New York, NY")
    
    Returns:
        Weather information as string
    """
    try:
        # wttr.in provides weather in JSON format
        url = f"https://wttr.in/{location}?format=j1"
        
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        
        data = response.json()
        
        # Extract current conditions
        current = data['current_condition'][0]
        
        temp_c = current['temp_C']
        temp_f = current['temp_F']
        feels_like_c = current['FeelsLikeC']
        feels_like_f = current['FeelsLikeF']
        condition = current['weatherDesc'][0]['value']
        humidity = current['humidity']
        wind_speed_kmph = current['windspeedKmph']
        wind_speed_mph = current['windspeedMiles']
        
        # Get location info
        nearest_area = data['nearest_area'][0]
        area_name = nearest_area['areaName'][0]['value']
        country = nearest_area['country'][0]['value']
        
        result = f"""Weather in {area_name}, {country}:
🌡️ Temperature: {temp_c}°C / {temp_f}°F (feels like {feels_like_c}°C / {feels_like_f}°F)
☁️ Conditions: {condition}
💧 Humidity: {humidity}%
🌬️ Wind Speed: {wind_speed_kmph} km/h / {wind_speed_mph} mph"""
        
        return result
        
    except requests.exceptions.Timeout:
        return f"Error: Request timed out while fetching weather for {location}"
    
    except requests.exceptions.RequestException as e:
        return f"Error: Could not fetch weather data: {str(e)}"
    
    except (KeyError, IndexError) as e:
        return f"Error: Could not parse weather data for {location}. Location might not exist."
    
    except Exception as e:
        return f"Unexpected error: {str(e)}"


# Tool definition for Claude API
WEATHER_TOOL: Dict = {
    "name": "get_weather",
    "description": "Get current weather information for any location worldwide. Returns temperature, conditions, humidity, and wind speed.",
    "input_schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city or location to get weather for (e.g., 'Paris', 'New York, NY', 'Tokyo')"
            }
        },
        "required": ["location"]
    }
}