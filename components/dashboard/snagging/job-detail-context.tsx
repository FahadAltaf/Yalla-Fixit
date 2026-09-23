"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingAuditEvent,
  type SnaggingFloorPlan,
  type SnaggingJobVisit,
  type SnaggingTask,
} from "@/types/types";

/*
  ─────────────────────────────────────────────────────────────────────────
  The job page's data, held once, above its tabs.

  Before this, every tab fetched for itself on mount, and the tab strip
  unmounts the tabs you are not looking at -- so going Snags → Quotation →
  Snags re-read the quotation, and every visit to History, Visits or
  Areas re-read those too. Copies of the same data (the visits, the rooms)
  lived in more than one tab and went stale independently: adding a visit
  from the header left the Visits tab showing the old list.

  Now each source of data is one SLICE here, fetched independently with
  its own loading, error and timestamp, and every tab reads the slice
  rather than holding a copy.

  SLICES AND WHO READS THEM (the dependency map -- extend it when a tab or
  a field is added, rather than giving the new tab its own copy):

    job        getTaskCore        The page header and everything on the
                                   job row: header card, assignment alert,
                                   Setup, the Areas count, the breadcrumb,
                                   which tab the page opens on.
               Fields shared across tabs: status, inspector, reviewer,
               appointment, property, areas, submissions.
    checklist  getTaskChecklist   Checklist tab and its count; the snag
                                   list's summary line.
    snags      getTaskSnags       Snags tab (header card stats, snag list)
                                   and its count. The heaviest section: it
                                   signs every photo.
    floorPlans listFloorPlans     The snag list's plan pins.
    visitStatus getTaskVisitStatus The visits not yet approved (report).
    desnag     getTaskDesnagQuotation The header's de-snag button.

    The job used to be one request carrying all six of those. They are
    separate endpoints now, fired together; the header renders as soon as
    `job` arrives and each section as soon as its own does.
    visits     listVisits         Visit alerts above the tabs, the
                                   Additional visits tab, the "Visit N"
                                   labels in the snag list, the count on
                                   the Additional visits tab.
    quotation  getQuotation       Quotation tab. Fetched when that tab is
                                   first opened, never on page load: opening
                                   it numbers the quotation automatically
                                   (the job's own rule), and that must not
                                   happen because somebody glanced at a job.
    audit      getAudit (paged)   History tab, one cached entry per page /
                                   size / order. Also fetched on first open.

  WHAT A CHANGE REFRESHES (so every tab reading it updates on its own):

    jobChanged()        job, plus the History page on screen
    areasChanged()      job (areas), floor plans, snags (room names, pins),
                        History
    visitsChanged()     visits, job, snags (a visit's finds), visit status,
                        History
    quotationChanged()  quotation, job (status), de-snag quotation, History
    refreshAll()        every slice that has been loaded

  Consistency: every slice keeps one request in flight. A newer request
  cancels the older one (AbortController) and only the newest response is
  applied, so a slow reply can never overwrite a fresher one -- last write
  wins, by re-fetch. Leaving the page cancels whatever is still loading.

  Deliberately NOT here: state that belongs to one tab alone -- filters,
  sort, pagination, form drafts, the floor-plan editor's working copy of
  its plans -- and the staff list the Setup tab reads (not job data).
  ─────────────────────────────────────────────────────────────────────────
*/

/** One piece of the page's data, with its own lifecycle. */
export type Slice<T> = {
  data: T | null;
  /** First load: there is nothing to show yet, so a skeleton stands in. */
  loading: boolean;
  /** Re-fetching data that IS on screen; it stays on screen meanwhile. */
  refreshing: boolean;
  error: string | null;
  /** When this slice last arrived, for staleness checks and "Updated at". */
  lastFetchedAt: number | null;
};

export type VisitsData = { visits: SnaggingJobVisit[]; versions: unknown[] };
export type ChecklistData = NonNullable<SnaggingTask["checklist"]>;
export type SnagsData = NonNullable<SnaggingTask["snags"]>;
export type VisitStatusData = { unapproved_visit_ids: string[] };
export type DesnagData = SnaggingTask["desnag_quotation"];
export type AuditPage = { data: SnaggingAuditEvent[]; totalCount: number };
export type AuditQuery = { page: number; pageSize: number; order: "asc" | "desc" };

const idle = <T,>(): Slice<T> => ({
  data: null,
  loading: false,
  refreshing: false,
  error: null,
  lastFetchedAt: null,
});
const loadingSlice = <T,>(): Slice<T> => ({ ...idle<T>(), loading: true });
/* A section that arrived with the page, read on the server. */
const readySlice = <T,>(data: T): Slice<T> => ({
  data,
  loading: false,
  refreshing: false,
  error: null,
  lastFetchedAt: Date.now(),
});

/**
 * The sections the page read on the server before it was sent (see
 * app/(dashboard)/snagging/[id]/page.tsx). A section given here starts on
 * screen; one left out is fetched as before. A key that is present with a
 * null value -- the de-snag quotation when there is none -- is an answer,
 * not a missing section.
 */
export type JobDetailInitial = Partial<{
  job: SnaggingTask;
  checklist: ChecklistData;
  snags: SnagsData;
  floorPlans: SnaggingFloorPlan[];
  visitStatus: VisitStatusData;
  desnag: DesnagData;
  visits: VisitsData;
}>;

function seed<T>(initial: JobDetailInitial | undefined, key: keyof JobDetailInitial): Slice<T> {
  return initial && key in initial && initial[key] !== undefined
    ? readySlice(initial[key] as T)
    : loadingSlice<T>();
}

const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === "AbortError";
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export const auditKey = (q: AuditQuery) => `${q.page}:${q.pageSize}:${q.order}`;

/**
 * A slice fetched on its own: one request in flight, the newest wins, and
 * data already on screen is kept while it refreshes.
 */
function useSlice<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  initial: Slice<T>,
  failure: string,
  /**
   * Called when this slice's cleanup cancels a request that had not come
   * back. A cancel is not an answer: whoever guards "asked already" must
   * forget it, or the slice waits forever for a reply that will not come.
   */
  onCancelled?: () => void,
) {
  const [state, setState] = useState<Slice<T>>(initial);
  const ticket = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /* True from sending a request until its answer (or failure) is applied. */
  const pending = useRef(false);

  const run = useCallback(async (): Promise<boolean> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const mine = ++ticket.current;
    pending.current = true;
    setState((s) =>
      s.data === null
        ? { ...s, loading: true, error: null }
        : { ...s, refreshing: true, error: null },
    );
    try {
      const data = await fetcher(controller.signal);
      if (mine !== ticket.current) return true;
      pending.current = false;
      setState({ data, loading: false, refreshing: false, error: null, lastFetchedAt: Date.now() });
      return true;
    } catch (error) {
      if (mine !== ticket.current || isAbort(error)) return true;
      pending.current = false;
      // A failed refresh keeps what is on screen and says so; only a slice
      // with nothing to show falls back to its error state.
      setState((s) => ({ ...s, loading: false, refreshing: false, error: messageOf(error, failure) }));
      return false;
    }
  }, [fetcher, failure]);

  /*
    Leaving the page cancels whatever is still on its way.

    The same cleanup also runs when React re-runs effects on a page that
    stays mounted -- Strict Mode, Fast Refresh, an <Activity> being hidden
    -- and the effects then run again. A request cancelled that way has to
    be asked for again, so the owner is told (onCancelled).
  */
  const cancelledRef = useRef(onCancelled);
  useEffect(() => {
    cancelledRef.current = onCancelled;
  }, [onCancelled]);
  useEffect(
    () => () => {
      const wasPending = pending.current;
      inFlight.current?.abort();
      if (wasPending) {
        pending.current = false;
        cancelledRef.current?.();
      }
    },
    [],
  );

  return { state, run };
}

type JobDetailValue = {
  taskId: string;
  /** The core job: header, property, areas, sign-off. */
  job: Slice<SnaggingTask>;
  checklist: Slice<ChecklistData>;
  snags: Slice<SnagsData>;
  floorPlans: Slice<SnaggingFloorPlan[]>;
  visitStatus: Slice<VisitStatusData>;
  desnag: Slice<DesnagData>;
  visits: Slice<VisitsData>;
  quotation: Slice<SnaggingQuotation>;
  /** History pages fetched so far, keyed by `auditKey`. */
  audit: Record<string, Slice<AuditPage>>;

  /** Loads the quotation the first time it is asked for; cached after. */
  ensureQuotation: () => void;
  /** Loads a History page unless it is already cached. */
  loadAudit: (query: AuditQuery) => void;

  refreshJob: () => Promise<boolean>;
  refreshChecklist: () => Promise<boolean>;
  refreshSnags: () => Promise<boolean>;
  refreshVisits: () => Promise<boolean>;
  refreshQuotation: () => Promise<boolean>;
  /** After something changed the job: re-reads the job and History. */
  jobChanged: () => void;
  /** After rooms or plans changed: job, floor plans, snags, History. */
  areasChanged: () => void;
  /** After a visit was added, booked, reviewed or cancelled. */
  visitsChanged: () => void;
  /** After the quotation was generated, sent or decided. */
  quotationChanged: () => void;
  /** Every loaded slice. Resolves true when all of them came back. */
  refreshAll: () => Promise<boolean>;
  /** True while any slice is re-fetching data already on screen. */
  refreshing: boolean;
};

const JobDetailContext = createContext<JobDetailValue | null>(null);

export function useJobDetail(): JobDetailValue {
  const value = useContext(JobDetailContext);
  if (!value) throw new Error("useJobDetail must be used inside <JobDetailProvider>");
  return value;
}

/** How old a slice may be before coming back to the page refreshes it. */
const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * The job page's data. Key it by the job id (`<JobDetailProvider
 * key={taskId}>`) so another job starts from nothing rather than showing
 * this one's data while its own loads.
 */
export function JobDetailProvider({
  taskId,
  initial,
  children,
}: {
  taskId: string;
  initial?: JobDetailInitial;
  children: ReactNode;
}) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);

  const fetchJob = useCallback(
    (signal: AbortSignal) => snaggingService.getTaskCore(taskId, { signal }),
    [taskId],
  );
  const fetchChecklist = useCallback(
    (signal: AbortSignal) => snaggingService.getTaskChecklist(taskId, { signal }),
    [taskId],
  );
  const fetchSnags = useCallback(
    (signal: AbortSignal) => snaggingService.getTaskSnags(taskId, { signal }),
    [taskId],
  );
  const fetchFloorPlans = useCallback(
    (signal: AbortSignal) => snaggingService.listFloorPlans(taskId, { signal }),
    [taskId],
  );
  const fetchVisitStatus = useCallback(
    (signal: AbortSignal) => snaggingService.getTaskVisitStatus(taskId, { signal }),
    [taskId],
  );
  const fetchDesnag = useCallback(
    (signal: AbortSignal) => snaggingService.getTaskDesnagQuotation(taskId, { signal }),
    [taskId],
  );
  const fetchVisits = useCallback(
    async (signal: AbortSignal): Promise<VisitsData> => {
      const body = await snaggingService.listVisits(taskId, { signal });
      return { visits: body.visits ?? [], versions: body.versions ?? [] };
    },
    [taskId],
  );

  /*
    The quotation, numbered on first open -- the rule the Quotation tab has
    always followed. Generating writes a numbered document, so it happens
    at most once per page, only for someone who may edit, and only when no
    quotation of any status exists (the server answers with a preview).
    If it fails the preview is shown, labelled as one.
  */
  const autoGenerated = useRef(false);
  const fetchQuotation = useCallback(
    async (signal: AbortSignal): Promise<SnaggingQuotation> => {
      const current = await snaggingService.getQuotation(taskId, { preview: true, signal });
      if (current?.preview && canEdit && !autoGenerated.current) {
        autoGenerated.current = true;
        try {
          // Generate answers with the quotation it wrote (the same columns
          // as a read), so it is not read back a second time.
          const generated = await snaggingService.quotationAction(taskId, "generate");
          if (generated) return generated;
        } catch (error) {
          if (isAbort(error)) throw error;
        }
      }
      return current as SnaggingQuotation;
    },
    [taskId, canEdit],
  );

  const job = useSlice(fetchJob, seed<SnaggingTask>(initial, "job"), "Could not load the inspection");
  const checklist = useSlice(
    fetchChecklist,
    seed<ChecklistData>(initial, "checklist"),
    "Could not load the checklist",
  );
  const snags = useSlice(fetchSnags, seed<SnagsData>(initial, "snags"), "Could not load the snags");
  const floorPlans = useSlice(
    fetchFloorPlans,
    seed<SnaggingFloorPlan[]>(initial, "floorPlans"),
    "Could not load the floor plans",
  );
  const visitStatus = useSlice(
    fetchVisitStatus,
    seed<VisitStatusData>(initial, "visitStatus"),
    "Could not load the visit status",
  );
  const desnag = useSlice(
    fetchDesnag,
    seed<DesnagData>(initial, "desnag"),
    "Could not load the de-snag quotation",
  );
  const visits = useSlice(
    fetchVisits,
    seed<VisitsData>(initial, "visits"),
    "Could not load the additional visits",
  );

  /*
    The Quotation tab asks for the quotation once (ensureQuotation). If
    that request is cancelled before it answers -- Strict Mode, Fast
    Refresh or <Activity> re-running the page's effects -- the "asked"
    flag is cleared, so the tab's effect, which runs again straight after,
    asks again instead of waiting on the cancelled request forever.
  */
  const quotationRequested = useRef(false);
  const forgetQuotationRequest = useCallback(() => {
    quotationRequested.current = false;
  }, []);
  const quotation = useSlice(
    fetchQuotation,
    idle<SnaggingQuotation>(),
    "Could not load the quotation",
    forgetQuotationRequest,
  );

  const { run: runJob } = job;
  const { run: runChecklist } = checklist;
  const { run: runSnags } = snags;
  const { run: runFloorPlans } = floorPlans;
  const { run: runVisitStatus } = visitStatus;
  const { run: runDesnag } = desnag;
  const { run: runVisits } = visits;
  const { run: runQuotation } = quotation;

  /*
    Every section at once, the core job first. Nothing waits on anything
    else: each slice renders as soon as its own response arrives.
  */
  /*
    Only what did not arrive with the page. When the server read every
    section, nothing is fetched here at all -- the page opens with its data
    instead of asking for it after it has loaded.
  */
  const arrived = useRef(initial);
  useEffect(() => {
    const has = (key: keyof JobDetailInitial) => {
      const given = arrived.current;
      return Boolean(given && key in given && given[key] !== undefined);
    };
    if (!has("job")) void runJob();
    if (!has("checklist")) void runChecklist();
    if (!has("snags")) void runSnags();
    if (!has("floorPlans")) void runFloorPlans();
    if (!has("visitStatus")) void runVisitStatus();
    if (!has("desnag")) void runDesnag();
    if (!has("visits")) void runVisits();
    // Not cleared after use: React re-runs this effect in development
    // (Strict Mode) and on Fast Refresh, and the sections are already on
    // screen then. Another job remounts the provider (it is keyed by id).
  }, [runJob, runChecklist, runSnags, runFloorPlans, runVisitStatus, runDesnag, runVisits]);

  const ensureQuotation = useCallback(() => {
    if (quotationRequested.current) return;
    quotationRequested.current = true;
    void runQuotation();
  }, [runQuotation]);

  // ── History: a cache of pages, the one on screen kept current ─────────
  const [audit, setAudit] = useState<Record<string, Slice<AuditPage>>>({});
  const auditLoaded = useRef(new Set<string>());
  const auditOnScreen = useRef<AuditQuery | null>(null);
  const auditTicket = useRef(0);
  const auditInFlight = useRef<AbortController | null>(null);

  const fetchAudit = useCallback(
    async (query: AuditQuery, force: boolean) => {
      const key = auditKey(query);
      auditOnScreen.current = query;
      if (!force && auditLoaded.current.has(key)) return true;

      auditInFlight.current?.abort();
      const controller = new AbortController();
      auditInFlight.current = controller;
      const mine = ++auditTicket.current;
      setAudit((all) => {
        const prev = all[key];
        return {
          ...all,
          [key]: prev?.data
            ? { ...prev, refreshing: true, error: null }
            : { ...loadingSlice<AuditPage>() },
        };
      });
      try {
        const page = await snaggingService.getAudit(taskId, { ...query, signal: controller.signal });
        if (mine !== auditTicket.current) return true;
        auditLoaded.current.add(key);
        setAudit((all) => ({
          ...all,
          [key]: { data: page, loading: false, refreshing: false, error: null, lastFetchedAt: Date.now() },
        }));
        return true;
      } catch (error) {
        if (mine !== auditTicket.current || isAbort(error)) return true;
        setAudit((all) => ({
          ...all,
          [key]: {
            ...(all[key] ?? idle<AuditPage>()),
            loading: false,
            refreshing: false,
            error: messageOf(error, "Could not load the history"),
          },
        }));
        return false;
      }
    },
    [taskId],
  );
  useEffect(() => () => auditInFlight.current?.abort(), []);

  const loadAudit = useCallback((query: AuditQuery) => void fetchAudit(query, false), [fetchAudit]);

  /*
    After a change, only the History page on screen is re-read; every
    other cached page is dropped, so paging back to one fetches it fresh
    rather than showing a trail without the latest entries.
  */
  const refreshAudit = useCallback(async () => {
    const onScreen = auditOnScreen.current;
    if (!onScreen) return true;
    const keep = auditKey(onScreen);
    auditLoaded.current = new Set([...auditLoaded.current].filter((k) => k === keep));
    setAudit((all) => (all[keep] ? { [keep]: all[keep] } : {}));
    return fetchAudit(onScreen, true);
  }, [fetchAudit]);

  // ── Changes: each re-reads exactly the slices it moves ────────────────
  const jobChanged = useCallback(() => {
    void runJob();
    void refreshAudit();
  }, [runJob, refreshAudit]);

  const areasChanged = useCallback(() => {
    void runJob();
    void runFloorPlans();
    void runSnags();
    void refreshAudit();
  }, [runJob, runFloorPlans, runSnags, refreshAudit]);

  const visitsChanged = useCallback(() => {
    void runVisits();
    void runJob();
    void runSnags();
    void runVisitStatus();
    void refreshAudit();
  }, [runVisits, runJob, runSnags, runVisitStatus, refreshAudit]);

  const quotationChanged = useCallback(() => {
    if (quotationRequested.current) void runQuotation();
    void runJob();
    void runDesnag();
    void refreshAudit();
  }, [runQuotation, runJob, runDesnag, refreshAudit]);

  const refreshAll = useCallback(async () => {
    const results = await Promise.all([
      runJob(),
      runChecklist(),
      runSnags(),
      runFloorPlans(),
      runVisitStatus(),
      runDesnag(),
      runVisits(),
      quotationRequested.current ? runQuotation() : Promise.resolve(true),
      refreshAudit(),
    ]);
    return results.every(Boolean);
  }, [
    runJob,
    runChecklist,
    runSnags,
    runFloorPlans,
    runVisitStatus,
    runDesnag,
    runVisits,
    runQuotation,
    refreshAudit,
  ]);

  /*
    Coming back to the page after a while (another browser tab, a phone
    call) re-reads whatever has gone stale, so a job left open all morning
    does not show the morning's state. Nothing fresh is re-fetched.
  */
  const jobAt = job.state.lastFetchedAt;
  const visitsAt = visits.state.lastFetchedAt;
  const quotationAt = quotation.state.lastFetchedAt;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const stale = (at: number | null) => at !== null && Date.now() - at > STALE_AFTER_MS;
      if (stale(jobAt)) void runJob();
      if (stale(visitsAt)) void runVisits();
      if (quotationRequested.current && stale(quotationAt)) void runQuotation();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [jobAt, visitsAt, quotationAt, runJob, runVisits, runQuotation]);

  const auditRefreshing = Object.values(audit).some((slice) => slice.refreshing);
  const value = useMemo<JobDetailValue>(
    () => ({
      taskId,
      job: job.state,
      checklist: checklist.state,
      snags: snags.state,
      floorPlans: floorPlans.state,
      visitStatus: visitStatus.state,
      desnag: desnag.state,
      visits: visits.state,
      quotation: quotation.state,
      audit,
      ensureQuotation,
      loadAudit,
      refreshJob: runJob,
      refreshChecklist: runChecklist,
      refreshSnags: runSnags,
      refreshVisits: runVisits,
      refreshQuotation: runQuotation,
      jobChanged,
      areasChanged,
      visitsChanged,
      quotationChanged,
      refreshAll,
      refreshing:
        job.state.refreshing ||
        checklist.state.refreshing ||
        snags.state.refreshing ||
        floorPlans.state.refreshing ||
        visitStatus.state.refreshing ||
        desnag.state.refreshing ||
        visits.state.refreshing ||
        quotation.state.refreshing ||
        auditRefreshing,
    }),
    [
      taskId,
      job.state,
      checklist.state,
      snags.state,
      floorPlans.state,
      visitStatus.state,
      desnag.state,
      visits.state,
      quotation.state,
      audit,
      ensureQuotation,
      loadAudit,
      runJob,
      runChecklist,
      runSnags,
      runVisits,
      runQuotation,
      jobChanged,
      areasChanged,
      visitsChanged,
      quotationChanged,
      refreshAll,
      auditRefreshing,
    ],
  );

  return <JobDetailContext.Provider value={value}>{children}</JobDetailContext.Provider>;
}
