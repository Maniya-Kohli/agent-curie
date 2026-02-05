import axios from "axios";

/**
 * Searches the web using the SerpAPI engine.
 * @param query - The search terms to look up.
 * @param numResults - Number of results to return (max 10).
 */
export const webSearch = async (
  query: string,
  numResults: number = 5,
): Promise<string> => {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    return "Web search is not configured. Please set SERPAPI_KEY in your .env file.";
  }

  try {
    const response = await axios.get("https://serpapi.com/search", {
      params: {
        q: query,
        api_key: apiKey,
        engine: "google",
        num: numResults,
      },
      timeout: 10000,
    });

    const results = response.data.organic_results || [];
    if (results.length === 0) return `No results found for query: ${query}`;

    let resultsText = `Search results for '${query}':\n\n`;

    results.slice(0, numResults).forEach((result: any, i: number) => {
      resultsText += `${i + 1}. ${result.title || "No title"}\n`;
      resultsText += `   ${result.snippet || "No description"}\n`;
      resultsText += `   🔗 ${result.link || ""}\n\n`;
    });

    return resultsText.trim();
  } catch (error) {
    return `Error performing search: ${error}`;
  }
};
