/**
 * Safely parses a JSON string
 * @param jsonString The JSON string or object to parse
 * @param fallback The fallback value to return if parsing fails
 * @returns The parsed JSON object or the fallback value
 */
export function safeJsonParse<T>(jsonString: string | unknown, fallback: T): T {
  if (!jsonString) return fallback;

  // If it's already an object, return it
  if (typeof jsonString !== "string") {
    return jsonString as T;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return fallback;
  }
}
