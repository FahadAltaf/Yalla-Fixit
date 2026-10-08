import { cn } from "@/lib/utils";

/**
 * Label-and-value rows for a record being read, as on Snagging's job
 * setup (DetailList in job-setup-panel.tsx). A missing value shows an em
 * dash, so the record keeps its shape whichever fields are filled in.
 */
export function DetailList({
  rows,
  className,
}: {
  rows: Array<{ label: string; value?: React.ReactNode; hint?: string | null }>;
  className?: string;
}) {
  return (
    <dl className={cn("divide-y", className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 text-right text-sm font-medium">
            {row.value === null || row.value === undefined || row.value === "" ? <span className="text-muted-foreground font-normal">—</span> : row.value}
            {row.hint ? <div className="text-muted-foreground text-xs font-normal">{row.hint}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
