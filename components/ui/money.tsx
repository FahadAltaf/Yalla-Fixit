import { DirhamIcon } from "@/components/ui/dirham-icon";
import { cn } from "@/lib/utils";

/**
 * An amount of money, shown the same way everywhere: the dirham sign
 * before a dirham figure, and the currency's own code for anything else.
 */
export function Money({
  value,
  currency = "AED",
  dp = 2,
  className,
}: {
  value: number | null | undefined;
  currency?: string | null;
  /** Decimal places. */
  dp?: number;
  className?: string;
}) {
  const amount = Number(value ?? 0);
  const code = currency || "AED";
  if (code !== "AED") {
    return (
      <span className={cn("tabular-nums whitespace-nowrap", className)}>
        {new Intl.NumberFormat("en-AE", {
          style: "currency",
          currency: code,
          minimumFractionDigits: dp,
          maximumFractionDigits: dp,
        }).format(amount)}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums whitespace-nowrap", className)}>
      <DirhamIcon className="size-[0.9em] shrink-0" aria-label="AED" role="img" />
      {new Intl.NumberFormat("en-AE", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(amount)}
    </span>
  );
}
