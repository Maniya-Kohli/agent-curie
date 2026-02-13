// src/tools/core/weather.ts

import axios from "axios";
import { registry } from "../registry";

export const getWeather = async (location: string): Promise<string> => {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

    const current = data.current_condition[0];
    const nearest = data.nearest_area[0];

    return `Weather in ${nearest.areaName[0].value}, ${nearest.country[0].value}:
🌡️ Temperature: ${current.temp_C}°C / ${current.temp_F}°F (feels like ${current.FeelsLikeC}°C / ${current.FeelsLikeF}°F)
☁️ Conditions: ${current.weatherDesc[0].value}
💧 Humidity: ${current.humidity}%
🌬️ Wind Speed: ${current.windspeedKmph} km/h / ${current.windspeedMiles} mph`;
  } catch (error: any) {
    if (error.code === "ECONNABORTED")
      return `Error: Request timed out while fetching weather for ${location}`;
    return `Error: Could not fetch weather data for ${location}. Location might not exist.`;
  }
};

registry.register({
  name: "get_weather",
  description: "Get current weather information for any location worldwide.",
  category: "core",
  input_schema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city or location (e.g., 'San Francisco')",
      },
    },
    required: ["location"],
  },
  function: (args: { location: string }) => getWeather(args.location),
});
