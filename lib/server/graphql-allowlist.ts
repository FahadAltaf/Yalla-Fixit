import { GET_SETTINGS_BY_ID } from "@/modules/settings/services/setting-graphql";

/** The persisted-query allowlist for /api/graphql (see the route). */
const normalise = (q: string) => q.replace(/\s+/g, " ").trim();
const ALLOWED = new Map<string, string>([[normalise(GET_SETTINGS_BY_ID), "getSettingsById"]]);

export function allowedGraphQLOperation(query: unknown, variables: unknown): string | null {
  if (typeof query !== "string" || query.length > 4000) return null;
  const name = ALLOWED.get(normalise(query));
  if (!name) return null;
  if (name === "getSettingsById") {
    /* { filter: { type: { eq: "<short string>" } } } and nothing more. */
    const v = variables as { filter?: { type?: { eq?: unknown } } } | null | undefined;
    const keys = v && typeof v === "object" ? Object.keys(v) : [];
    const typeEq = v?.filter?.type?.eq;
    if (keys.length !== 1 || keys[0] !== "filter" || typeof typeEq !== "string" || typeEq.length > 40) return null;
    if (Object.keys(v!.filter!).length !== 1 || Object.keys(v!.filter!.type!).length !== 1) return null;
  }
  return name;
}
