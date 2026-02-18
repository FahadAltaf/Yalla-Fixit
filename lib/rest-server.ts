/**
 * REST API server helper for making requests to Next.js API routes
 * Similar to executeGraphQLBackend but for REST operations
 */

export async function executeRESTBackend<T = unknown>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    params?: Record<string, string | number>;
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  try {
    const { method = "GET", params, body } = options;

    // Build URL - use relative URL for client-side, absolute for server-side
    let url: URL;
    if (typeof window !== "undefined") {
      // Client-side: use relative URL
      url = new URL(endpoint, window.location.origin);
    } else {
      // Server-side: use env or default
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      url = new URL(endpoint, baseUrl);
    }
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const requestOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "PUT")) {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), requestOptions);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    // For paginated responses that return { data: [...], totalCount: ... },
    // we need to return the whole result, not just result.data
    // Check if result has both data and totalCount (paginated response)
    if (result.data !== undefined && result.totalCount !== undefined) {
      return result as T;
    }
    // Otherwise, return result.data if it exists, or the whole result
    return (result.data !== undefined ? result.data : result) as T;
  } catch (error) {
    console.error("REST API Error:", error);
    throw error;
  }
}
