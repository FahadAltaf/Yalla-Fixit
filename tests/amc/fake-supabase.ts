/**
 * A small in-memory stand-in for the Supabase client, covering only the
 * query shapes the AMC notification and archive code uses. Enough to prove
 * behaviour (what is written, what is skipped as a duplicate), not a
 * PostgREST emulator. Not a test file itself.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

export interface FakeOptions {
  /** Unique keys per table, by column list (as `onConflict` names them). */
  unique?: Record<string, string[][]>;
  /** Computed columns, like recipient_key. */
  generated?: Record<string, (row: Row) => Row>;
}

export function fakeSupabase(seed: Record<string, Row[]> = {}, options: FakeOptions = {}) {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const files = new Map<string, { bucket: string; body: Uint8Array; contentType?: string }>();
  let nextId = 1;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const withGenerated = (name: string, row: Row) => ({ ...row, ...(options.generated?.[name]?.(row) ?? {}) });
  const conflicts = (name: string, row: Row, keys?: string[]) => {
    const sets = keys ? [keys] : (options.unique?.[name] ?? []);
    return table(name).some((existing) => sets.some((cols) => cols.every((c) => existing[c] === row[c])));
  };

  class Query implements PromiseLike<Result> {
    private filters: Array<(r: Row) => boolean> = [];
    private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    private payload: Row[] = [];
    private patch: Row = {};
    private onConflict?: string[];
    private ignoreDuplicates = false;
    private returning = false;
    private mode: "one" | "maybe" | null = null;
    private head = false;
    private wantCount = false;
    private limitN: number | null = null;
    constructor(private name: string) {}

    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      this.returning = true;
      if (opts?.head) this.head = true;
      if (opts?.count) this.wantCount = true;
      return this;
    }
    insert(rows: Row | Row[]) {
      this.op = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      this.op = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.onConflict = opts?.onConflict?.split(",").map((s) => s.trim());
      this.ignoreDuplicates = opts?.ignoreDuplicates === true;
      return this;
    }
    update(patch: Row) {
      this.op = "update";
      this.patch = patch;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    neq(c: string, v: unknown) {
      this.filters.push((r) => r[c] !== v);
      return this;
    }
    is(c: string, v: unknown) {
      this.filters.push((r) => (v === null ? r[c] == null : r[c] === v));
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    not(c: string, op: string, v: unknown) {
      if (op === "is" && v === null) this.filters.push((r) => r[c] != null);
      return this;
    }
    gt(c: string, v: string) {
      this.filters.push((r) => String(r[c]) > v);
      return this;
    }
    gte(c: string, v: string) {
      this.filters.push((r) => String(r[c]) >= v);
      return this;
    }
    lte(c: string, v: string) {
      this.filters.push((r) => String(r[c]) <= v);
      return this;
    }
    order() {
      return this;
    }
    or() {
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }
    range(from: number, to: number) {
      this.limitN = to - from + 1;
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }
    single() {
      this.mode = "one";
      return this;
    }
    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve()
        .then(() => this.run())
        .then(onfulfilled, onrejected);
    }
    private match(r: Row) {
      return this.filters.every((f) => f(r));
    }
    private shape(rows: Row[]): Result {
      const limited = this.limitN === null ? rows : rows.slice(0, this.limitN);
      if (this.head) return { data: null, error: null, count: rows.length };
      if (this.mode) {
        if (limited.length > 1 && this.mode === "one") return { data: null, error: { message: "multiple rows" } };
        if (limited.length === 0 && this.mode === "one") return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: limited[0] ?? null, error: null };
      }
      return { data: limited, error: null, count: this.wantCount ? rows.length : null };
    }
    private run(): Result {
      const rows = table(this.name);
      switch (this.op) {
        case "select":
          return this.shape(rows.filter((r) => this.match(r)));
        case "insert":
        case "upsert": {
          const written: Row[] = [];
          for (const raw of this.payload) {
            const row = withGenerated(this.name, { id: raw.id ?? `fake-${nextId++}`, created_at: new Date().toISOString(), ...raw });
            if (conflicts(this.name, row, this.op === "upsert" ? this.onConflict : undefined)) {
              if (this.op === "upsert" && this.ignoreDuplicates) continue;
              return { data: null, error: { code: "23505", message: `duplicate key on ${this.name}` } };
            }
            rows.push(row);
            written.push(row);
          }
          return this.returning ? this.shape(written) : { data: null, error: null };
        }
        case "update": {
          const hit = rows.filter((r) => this.match(r));
          for (const r of hit) Object.assign(r, this.patch);
          return this.returning ? this.shape(hit) : { data: null, error: null };
        }
        case "delete": {
          const hit = rows.filter((r) => this.match(r));
          tables.set(this.name, rows.filter((r) => !hit.includes(r)));
          return this.returning ? this.shape(hit) : { data: null, error: null };
        }
      }
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, opts?: { contentType?: string; upsert?: boolean }) => {
          if (files.has(path) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } };
          files.set(path, { bucket, body, contentType: opts?.contentType });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(p);
          return { data: null, error: null };
        },
        createSignedUrl: async (path: string, ttl: number) => ({
          data: files.has(path) ? { signedUrl: `https://storage.test/${bucket}/${path}?ttl=${ttl}` } : null,
          error: files.has(path) ? null : { message: "Object not found" },
        }),
        createSignedUrls: async (paths: string[], ttl: number) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?ttl=${ttl}` })),
          error: null,
        }),
      }),
    },
  };
  return { client, tables, files, table };
}
