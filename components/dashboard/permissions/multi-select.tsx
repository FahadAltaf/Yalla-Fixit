"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select options",
  disabled = false,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (option: string) => {
    const isSelected = selected.includes(option);
    if (isSelected) {
      onChange(selected.filter((item) => item !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const displayText = React.useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) return selected[0];
    if (selected.length === options.length) return "All selected";

    // Show first few items with count
    const firstTwo = selected.slice(0, 2).join(", ");
    if (selected.length > 2) {
      return `${firstTwo}, +${selected.length - 2}`;
    }
    return firstTwo;
  }, [selected, options, placeholder]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-sm font-normal h-9 bg-transparent"
          disabled={disabled}
        >
          <span className="truncate">{displayText}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <div
              key={option}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer hover:bg-accent transition-colors",
                isSelected && "bg-accent/50"
              )}
              onClick={() => handleSelect(option)}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => handleSelect(option)}
                className="pointer-events-none"
              />
              <span className="text-sm flex-1">{option}</span>
              {isSelected && <Check className="size-4 text-primary" />}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
