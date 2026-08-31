"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The last line of defence for a snagging screen.
 *
 * A render-time crash used to take the whole dashboard shell down to a
 * blank page with nothing to click. This keeps the user inside the
 * product, says plainly that the screen failed rather than that the data
 * is empty, and offers the one action that usually fixes it.
 */
export default function SnaggingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Snagging screen error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <span className="bg-destructive/10 mx-auto flex size-14 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </span>
        <h1 className="mt-4 text-xl">This screen could not be displayed</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Something went wrong while rendering it. Your data has not been changed.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground mt-3 font-mono text-xs">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/snagging">Back to overview</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
