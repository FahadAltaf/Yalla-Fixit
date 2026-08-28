"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import type { TechnicianReference } from "@/modules/scheduling";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// S1: per-shift show/hide picker for the Technician column header.
//
// This replaces a hand-rolled popover -- a `fixed` panel positioned from a
// measured getBoundingClientRect, with a full-screen div behind it to catch
// outside clicks, and native checkboxes. Radix Popover portals the content
// (so the scroll pane can no longer clip it) and handles placement,
// collision flipping, Escape and outside-click on its own; cmdk supplies the
// filtering and arrow-key navigation the old list never had.

export default function TechnicianPicker({
  title,
  technicians,
  hiddenIds,
  onToggle,
  onSetHidden,
}: {
  title: string;
  technicians: TechnicianReference[];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
  onSetHidden: (ids: string[], hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  const allIds = technicians.map((t) => t.fsm_resource_id);
  const hiddenCount = technicians.filter((t) => hiddenIds.has(t.fsm_resource_id)).length;
  const shownCount = technicians.length - hiddenCount;
  const sorted = [...technicians].sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-auto gap-1 px-1.5 py-0.5 text-[11px] font-medium"
          aria-label={`Show or hide ${title.toLowerCase()} technicians`}
        >
          <Users className="size-3.5" />
          {hiddenCount > 0 ? `${hiddenCount} hidden` : "All"}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-64 gap-0 p-0" align="start">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Show on the board</p>
          <p className="text-muted-foreground text-xs">
            {title} · {shownCount} of {technicians.length} shown
          </p>
        </div>

        <Command>
          {/* cmdk filters the list itself, so there is no separate search
              state to keep in step. */}
          <CommandInput placeholder="Filter technicians..." />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {technicians.length === 0 ? "No technicians in this shift." : "No technicians found."}
            </CommandEmpty>
            <CommandGroup>
              {sorted.map((t) => {
                const visible = !hiddenIds.has(t.fsm_resource_id);
                return (
                  <CommandItem
                    key={t.fsm_resource_id}
                    value={t.display_name}
                    onSelect={() => onToggle(t.fsm_resource_id)}
                    className="cursor-pointer gap-2"
                  >
                    {/* The row is the control; the checkbox only reflects
                        state, so it must not swallow the click. */}
                    <Checkbox checked={visible} className="pointer-events-none" tabIndex={-1} />
                    <span className="truncate">{t.display_name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        <div className="flex items-center gap-1 border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={hiddenCount === 0}
            onClick={() => onSetHidden(allIds, false)}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={shownCount === 0}
            onClick={() => onSetHidden(allIds, true)}
          >
            Deselect all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
