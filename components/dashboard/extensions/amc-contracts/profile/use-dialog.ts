"use client";

import { useCallback, useState } from "react";

/**
 * An always-mounted, controlled dialog, the way Snagging's are.
 *
 * `key` changes on every open, so the form inside starts from the record
 * it was opened for; and the record is kept while the dialog closes, so
 * its title does not blank out during the closing animation.
 */
export function useDialog<T = true>() {
  const [state, setState] = useState<{ open: boolean; target: T | null; key: number }>({ open: false, target: null, key: 0 });
  const show = useCallback((target: T) => setState((s) => ({ open: true, target, key: s.key + 1 })), []);
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setState((s) => ({ ...s, open: false }));
  }, []);
  return { open: state.open, target: state.target, key: state.key, show, onOpenChange };
}
