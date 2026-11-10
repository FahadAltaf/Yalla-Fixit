import { fsmFetch, type FsmResult } from "@/lib/server/zoho/fsm-client";

/**
 * Read-only access to Zoho FSM for the Finance and Reports modules.
 *
 * This project reads FSM and never writes to it (BRD v1.0 §3: "Zoho FSM
 * (read only, no change to FSM)"). There is no FSM sandbox: every call the
 * portal makes lands on the production tenant, and on this branch the
 * portal also runs against the production database. So "read only" is not
 * left to discipline. It is built into the shape of this client:
 *
 *   - `get(path)` takes a path and nothing else. There is no `init` to put
 *     a method or a body in, so a write cannot be expressed through it.
 *   - The request is sent as an explicit GET, and the method is asserted
 *     again just before sending, so a caller that reaches past the type
 *     (a cast, a spread) is still stopped.
 *   - Paths that name an FSM action (`/actions/...`) are refused outright.
 *     They are POST/PUT endpoints today; refusing the path means a future
 *     GET-shaped action cannot slip through either.
 *   - It is off unless FINANCE_FSM_READ=on, so a deployment that has not
 *     opted in makes no FSM calls from this module at all.
 *   - Each reader has a call budget. FSM's API limits are per org per day,
 *     shared with scheduling and snagging; a sync that loops must stop at a
 *     ceiling rather than spend the whole org's allowance.
 *
 * `fsmFetch` is reused for everything else: its timeout, its retries on
 * 429/408/5xx and its Retry-After handling are already right.
 */

export class FsmReadDisabledError extends Error {
  constructor() {
    super("Finance FSM reads are switched off (set FINANCE_FSM_READ=on to enable).");
    this.name = "FsmReadDisabledError";
  }
}

export class FsmWriteRefusedError extends Error {
  constructor(detail: string) {
    super(`Refused: the finance FSM client is read-only (${detail}).`);
    this.name = "FsmWriteRefusedError";
  }
}

export class FsmBudgetExceededError extends Error {
  constructor(budget: number) {
    super(`FSM call budget of ${budget} reached for this run; stopping rather than spending the org's daily allowance.`);
    this.name = "FsmBudgetExceededError";
  }
}

/** True only when this deployment has opted in to finance FSM reads. */
export function financeFsmReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FINANCE_FSM_READ === "on";
}

/** The one method this client will ever send. */
const READ_METHOD = "GET";

/**
 * Throws unless the request is a GET to a non-action path.
 *
 * Exported so a test can prove the guard on its own, and so any other
 * finance code that has to build a request by hand can apply the same rule.
 */
export function assertReadOnlyRequest(path: string, init: RequestInit): void {
  const method = (init.method ?? "").toUpperCase();
  if (method !== READ_METHOD) {
    throw new FsmWriteRefusedError(`method ${method || "(none)"} on ${path}`);
  }
  if (init.body !== undefined && init.body !== null) {
    throw new FsmWriteRefusedError(`a request body on ${path}`);
  }
  if (/\/actions(\/|$|\?)/i.test(path)) {
    throw new FsmWriteRefusedError(`action endpoint ${path}`);
  }
  if (!path.startsWith("/")) {
    // fsmFetch prefixes the base URL; anything else would be a full URL and
    // could point anywhere.
    throw new FsmWriteRefusedError(`a path that does not start with "/" (${path})`);
  }
}

type Fetcher = (
  token: string,
  path: string,
  init: RequestInit,
) => Promise<FsmResult>;

export type FsmReader = {
  /** GET one FSM path. Counts against the budget whatever the outcome. */
  get(path: string): Promise<FsmResult>;
  /** Calls made so far in this run. */
  calls(): number;
  /** The ceiling for this run. */
  readonly budget: number;
};

export const DEFAULT_FSM_CALL_BUDGET = 500;

/**
 * A read-only FSM client for one run (a sync pass, a discovery spike).
 *
 * `fetcher` exists for tests, which must never reach the real FSM. In
 * application code leave it out and the shared `fsmFetch` is used.
 */
export function createFsmReader(options: {
  token: string;
  budget?: number;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
}): FsmReader {
  const budget = options.budget ?? DEFAULT_FSM_CALL_BUDGET;
  const send: Fetcher =
    options.fetcher ?? ((token, path, init) => fsmFetch(token, path, init));
  const env = options.env ?? process.env;
  let calls = 0;

  return {
    budget,
    calls: () => calls,
    async get(path: string) {
      if (!financeFsmReadEnabled(env)) throw new FsmReadDisabledError();
      if (calls >= budget) throw new FsmBudgetExceededError(budget);

      const init: RequestInit = { method: READ_METHOD };
      assertReadOnlyRequest(path, init);

      calls += 1;
      return send(options.token, path, init);
    },
  };
}
