/**
 * One browser path for every AMC API call, with a small cache in front.
 *
 * Every AMC service used to keep its own copy of `request()` and nothing was
 * shared: a page, its tabs and a popup opened over it each fetched the same
 * record again. Calls now come through here:
 *
 * - Reads (GET) asked for at the same moment share one request.
 * - A read answered a moment ago is answered again from memory: a record
 *   for RECORD_TTL_MS, a list that rarely changes (people, configuration,
 *   rate card, checklist, catalogue) for STABLE_TTL_MS.
 * - Any write (POST, PUT, PATCH, DELETE) drops the cached records, since one
 *   save can change several (booking a visit moves its enquiry). The stable
 *   lists are dropped only by a write to their own area or to the settings.
 * - `amcFresh(run)` makes the reads started inside `run` skip the cache:
 *   Refresh and the reload after a save always see the server.
 *
 * Only successful answers are kept. The cache lives in the tab's memory and
 * goes with it; signing out reloads the page, so nothing passes to the next
 * person.
 */

import { SessionExpiredError, extractErrorMessage } from "@/lib/rest-server";

export type AmcJson = { ok: boolean; status: number; body: unknown };

const RECORD_TTL_MS = 15_000;
const STABLE_TTL_MS = 120_000;
const MAX_ENTRIES = 300;

/* Reads that rarely change: kept longer, and kept through ordinary saves. */
const STABLE_READS: readonly RegExp[] = [
  /^\/api\/amc-config(\/|\?|$)/,
  /^\/api\/amc-enquiries\/meta(\?|$)/,
  /^\/api\/amc-contracts\/assessments\/book(\?|$)/,
  /^\/api\/amc-contracts\/coverage\?catalogue=1$/,
  /^\/api\/amc-contracts\/fsm\/services(\?|$)/,
  /^\/api\/amc-contracts\/settings\//,
  /^\/api\/amc-proposal-rules(\?|$)/,
  /^\/api\/amc-rate-card(\/|\?|$)/,
  /^\/api\/amc-technicians(\?|$)/,
  /^\/api\/amc-field-visits\/technicians(\?|$)/,
  /* AMC settings (wording, catalogue, approvers): the wizard and every Preview/Download read them (13 Nov 2026). */
  /^\/api\/amc-settings(\?|$)/,
  /* Who can approve a site visit (16 Nov 2026). */
  /^\/api\/amc-contracts\/assessments\/approvers(\?|$)/,
];

/*
  POSTs that only read (a body too structured for a query string). Sent
  every time, never cached, and never counted as a write: the call-out
  coverage preview used to drop every cached record on each change.
*/
const READ_POSTS: readonly RegExp[] = [/^\/api\/amc-call-outs\/coverage(\?|$)/];

/* Writes here can change any stable list (a settings change reaches the catalogue, the rules, the people's roles). */
const SETTINGS_WRITES: readonly RegExp[] = [
  /^\/api\/amc-config/,
  /^\/api\/amc-rate-card/,
  /^\/api\/amc-proposal-rules/,
  /^\/api\/amc-contracts\/settings/,
  /^\/api\/amc-contracts\/fsm/,
  /^\/api\/amc-technicians/,
  /^\/api\/amc-settings/,
];

type Entry = { at: number; stable: boolean; value: AmcJson };

const done = new Map<string, Entry>();
const inFlight = new Map<string, Promise<AmcJson>>();
/* The generation each in-flight read started in: a fresh read can share one started since the last save or Refresh. */
const inFlightGen = new Map<string, number>();
/* Bumped by every write, so a read that started before it is not stored after it. */
let generation = 0;
let freshDepth = 0;

/*
  Refresh (27 Nov 2026): every AMC loader on the page reloads, not only the
  page's own record (a visit's charge, quotation, access and job sheet
  cards kept what they had), and the button turns while the reads it set
  off are on their way (a list's Refresh showed nothing happening).
*/
export const AMC_REFRESH_EVENT = "amc:refresh";
let pendingReads = 0;
let refreshing = false;
const refreshListeners = new Set<() => void>();
function setRefreshing(next: boolean) {
  if (refreshing === next) return;
  refreshing = next;
  for (const listener of refreshListeners) listener();
}
/* Done once nothing is left on its way (a beat later, for reads that start after a render). */
function settleRefresh(delay: number) {
  setTimeout(() => {
    if (pendingReads === 0) setRefreshing(false);
  }, delay);
}
/** For useAmcRefreshing: told when a Refresh starts and when its reads are in. */
export function subscribeAmcRefreshing(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}
/** Whether a Refresh is still loading. */
export function amcRefreshing(): boolean {
  return refreshing;
}

const pathOf = (url: string) => url.split("#")[0];
/* "/api/amc-contracts/assessments/123?x" → "/api/amc-contracts/assessments": a write's own area. */
const areaOf = (url: string) => pathOf(url).split("?")[0].split("/").slice(0, 4).join("/");
const isStable = (url: string) => STABLE_READS.some((r) => r.test(url));

function prune(now: number) {
  for (const [key, entry] of done) {
    if (now - entry.at > (entry.stable ? STABLE_TTL_MS : RECORD_TTL_MS)) done.delete(key);
  }
  while (done.size > MAX_ENTRIES) {
    const oldest = done.keys().next().value;
    if (oldest === undefined) break;
    done.delete(oldest);
  }
}

/** Drops cached reads: every one, or those whose address starts with `prefix`. */
export function clearAmcCache(prefix?: string): void {
  generation += 1;
  if (!prefix) {
    done.clear();
    inFlight.clear();
    return;
  }
  for (const key of [...done.keys()]) if (key.startsWith(prefix)) done.delete(key);
  for (const key of [...inFlight.keys()]) if (key.startsWith(prefix)) inFlight.delete(key);
}

/* After a write: the records go; a stable list goes when the write is in its area or the settings. */
function afterWrite(url: string) {
  generation += 1;
  inFlight.clear();
  const path = pathOf(url);
  const settings = SETTINGS_WRITES.some((r) => r.test(path));
  const area = areaOf(path);
  for (const [key, entry] of [...done]) {
    if (!entry.stable || settings || key.startsWith(area)) done.delete(key);
  }
}

/**
 * Runs `run` with the cache skipped for every read it starts straight away
 * (before its first await), e.g. `amcFresh(() => service.record(id))`.
 */
export function amcFresh<T>(run: () => T): T {
  freshDepth += 1;
  try {
    return run();
  } finally {
    freshDepth -= 1;
  }
}

async function send(url: string, init?: RequestInit): Promise<AmcJson> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

/** One AMC API call: the status and the parsed body. Each service turns a failure into its own error. */
export function amcFetchJson(url: string, init?: RequestInit): Promise<AmcJson> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    if (READ_POSTS.some((r) => r.test(pathOf(url)))) return send(url, init);
    return send(url, init).finally(() => afterWrite(url));
  }

  const key = pathOf(url);
  const now = Date.now();
  if (freshDepth === 0) {
    const hit = done.get(key);
    if (hit && now - hit.at <= (hit.stable ? STABLE_TTL_MS : RECORD_TTL_MS)) return Promise.resolve(hit.value);
    const pending = inFlight.get(key);
    if (pending) return pending;
  } else {
    /* Fresh, but one Refresh can ask twice (a card's own reload and the page's): share a read started since it (27 Nov 2026). */
    const pending = inFlight.get(key);
    if (pending && inFlightGen.get(key) === generation) return pending;
  }

  const startedIn = generation;
  pendingReads += 1;
  const request = send(url, init).then((value) => {
    if (inFlight.get(key) === request) inFlight.delete(key);
    /* Kept only when it succeeded and nothing was saved while it was on its way. */
    if (value.ok && startedIn === generation) {
      done.delete(key);
      done.set(key, { at: Date.now(), stable: isStable(key), value });
      prune(Date.now());
    }
    return value;
  });
  request.catch(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  void request.then(
    () => readSettled(),
    () => readSettled(),
  );
  inFlight.set(key, request);
  inFlightGen.set(key, startedIn);
  return request;
}

/** The message a failed AMC call carries, or the fallback. */
export function amcErrorMessage(body: unknown, fallback = "Something went wrong"): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

/** The usual AMC call: the body on success, an Error with the API's message otherwise. */
export async function amcRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const { ok, body } = await amcFetchJson(url, init);
  if (!ok) throw new Error(amcErrorMessage(body));
  return body as T;
}

/**
 * The same call as executeRESTBackend (params, a JSON body, `data`
 * unwrapped, a 401 as SessionExpiredError), through this cache: for the
 * proposal and settings services, which used executeRESTBackend directly,
 * so skipped the cache and emptied all of it on every save (13 Nov 2026).
 */
export async function amcRest<T = unknown>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    params?: Record<string, string | number>;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const { method = "GET", params, body } = options;
  let url = endpoint;
  if (params) {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    url += (url.includes("?") ? "&" : "?") + query.toString();
  }
  const result = await amcFetchJson(url, { method, ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  if (!result.ok) {
    if (result.status === 401) throw new SessionExpiredError();
    throw new Error(extractErrorMessage(result.body, result.status));
  }
  const value = result.body as { data?: unknown; totalCount?: unknown } | null;
  if (value && value.data !== undefined && value.totalCount !== undefined) return value as T;
  return (value && value.data !== undefined ? value.data : value) as T;
}

function readSettled() {
  pendingReads = Math.max(0, pendingReads - 1);
  if (refreshing && pendingReads === 0) settleRefresh(150);
}

/**
 * A Refresh button: drops the cached AMC reads, tells every AMC loader on
 * the page to read again (useAmcData, useAmcRefreshSignal), and runs
 * `reload`, so everything shown comes from the server.
 */
export function amcRefresh(reload?: () => void): void {
  clearAmcCache();
  setRefreshing(true);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AMC_REFRESH_EVENT));
  reload?.();
  settleRefresh(600);
}
