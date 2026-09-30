/**
 * pg_graphql queries, from either side of the app.
 *
 * In the browser this posts to `/api/graphql`, which forwards the query
 * with the anon key and asks for no session (pages used before sign-in
 * call it). On the server it talks to Supabase directly and skips the
 * HTTP hop.
 */
export async function executeGraphQLBackend<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const onServer = typeof window === "undefined";

  const url = onServer
    ? `${process.env.SUPABASE_URL}/graphql/v1`
    : "/api/graphql";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (onServer) headers.apikey = process.env.SUPABASE_ANON_KEY!;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      // Node's fetch has no default response timeout; without this a hung
      // socket pins the caller indefinitely.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    // Supabase answers `{ data, errors }`; the route re-wraps it as `{ data }`.
    if (onServer && Array.isArray(result.errors) && result.errors.length > 0) {
      throw new Error(result.errors[0]?.message ?? "GraphQL query failed");
    }

    return result.data as T;
  } catch (error) {
    console.error("GraphQL Error:", error);
    throw error;
  }
}
