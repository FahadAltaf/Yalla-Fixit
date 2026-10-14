"use client";

import { useCallback, useEffect, useState } from "react";

import {
  snaggingService,
  type SnagPageQuery,
  type SnagPageResult,
} from "@/modules/snagging";

type Settled = {
  key: string;
  signal: unknown;
  nonce: number;
  data: SnagPageResult | null;
  error: string | null;
};

/**
 * One page of a job's snag list, from the server.
 *
 * The list used to be the job's whole snag set, every photo signed, filtered
 * and paged in the browser. Each filter, sort or page turn is a request for
 * exactly that page now (GET /tasks/[id]/snags/page); only its photos are
 * signed. The previous page stays on screen while the next loads, so the
 * list does not flash empty on every click.
 *
 * `refreshSignal` is anything that changes when the job's snags change (the
 * page's summary list): the current page is read again when it does, so an
 * edit made anywhere on the page shows here too.
 *
 * Loading is worked out from which request last settled rather than set
 * when one starts, so the effect only ever updates state from its answer.
 */
export function useSnagPage(
  taskId: string,
  query: SnagPageQuery,
  refreshSignal?: unknown,
  /** False while nothing is shown (a closed popup): no request is made. */
  enabled = true,
) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [lastData, setLastData] = useState<SnagPageResult | null>(null);
  const [nonce, setNonce] = useState(0);

  const key = `${taskId}|${JSON.stringify(query)}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const request = { key, signal: refreshSignal, nonce };
    snaggingService
      .getTaskSnagPage(taskId, JSON.parse(key.slice(key.indexOf("|") + 1)) as SnagPageQuery, {
        signal: controller.signal,
      })
      .then((data) => {
        setSettled({ ...request, data, error: null });
        setLastData(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          ...request,
          data: null,
          error: err instanceof Error ? err.message : "Could not load the snags",
        });
      });
    return () => controller.abort();
  }, [taskId, key, refreshSignal, nonce, enabled]);

  const current =
    settled !== null &&
    settled.key === key &&
    settled.signal === refreshSignal &&
    settled.nonce === nonce;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    // The newest answer, kept on screen while the next page loads.
    data: lastData,
    loading: enabled && !current,
    error: current ? settled.error : null,
    reload,
  };
}
