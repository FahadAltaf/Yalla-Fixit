"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/actions/utils";
import { mentionToken, splitMentions } from "@/lib/todos/mentions";
import type { MentionableUser } from "@/modules/todos";

/*
  FR-17: a comment box that offers the portal's users when "@" is typed.

  What is stored is the token form, `@[Name](uuid)` (lib/todos/mentions.ts).
  What the person sees while typing is `@Name`: the box keeps a map of the
  names picked (or already in the text) to their ids, shows the plain form,
  and turns it back into tokens on every change. A name typed by hand that
  matches a picked one becomes a mention too; a name that matches nothing
  stays plain text.

  Keyboard: up and down move, Enter or Tab picks, Escape closes the list,
  Ctrl+Enter (Cmd+Enter) posts. The list is plain markup rather than the
  Command component because focus has to stay in the textarea.
*/

const MAX_SUGGESTIONS = 8;

// "@" plus whatever follows it up to the caret, when it is at a word start.
const TRIGGER = /(^|[\s(])@([^\s@[\]()]{0,40})$/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Token form → what the person sees: `@Name`. */
function tokensToDisplay(value: string) {
  return splitMentions(value)
    .map((part) => (part.kind === "text" ? part.text : `@${part.name}`))
    .join("");
}

/** Display form → token form, for every name in the map (longest first). */
function displayToTokens(display: string, names: Map<string, string>) {
  let out = display;
  const entries = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [name, id] of entries) {
    const pattern = new RegExp(`@${escapeRegExp(name)}(?![\\w])`, "g");
    out = out.replace(pattern, mentionToken(name, id));
  }
  return out;
}

export function CommentComposer({
  value,
  onChange,
  users,
  onSubmit,
  submitting,
  submitLabel = "Add",
  onCancel,
  placeholder = "Add a comment. Type @ to mention someone",
  autoFocus,
  leading,
}: {
  // The token form; what is saved.
  value: string;
  onChange: (value: string) => void;
  users: MentionableUser[];
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  // Something to put at the left of the action row, such as an attach button.
  leading?: React.ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // Names picked in this box. Names already in the text are read from the
  // tokens when needed, so an edited comment keeps its mentions.
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map());
  const namesFor = (tokenValue: string, extra?: Map<string, string>) => {
    const names = new Map(picked);
    splitMentions(tokenValue).forEach((part) => {
      if (part.kind === "mention") names.set(part.name, part.userId);
    });
    extra?.forEach((id, name) => names.set(name, id));
    return names;
  };

  const display = useMemo(() => tokensToDisplay(value), [value]);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const query = trigger.query.toLowerCase();
    return users
      .filter((user) => !query || user.name.toLowerCase().includes(query) || (user.email ?? "").toLowerCase().includes(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [trigger, users]);

  const emit = (nextDisplay: string, extra?: Map<string, string>) =>
    onChange(displayToTokens(nextDisplay, namesFor(value, extra)));

  const detectTrigger = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = TRIGGER.exec(before);
    if (!match) {
      setTrigger(null);
      return;
    }
    const next = { start: caret - match[2].length - 1, query: match[2] };
    // A new query starts the highlight back at the first suggestion.
    if (next.query !== trigger?.query) setActive(0);
    setTrigger(next);
  };

  const pick = (user: MentionableUser) => {
    if (!trigger) return;
    const caret = textareaRef.current?.selectionEnd ?? display.length;
    const name = user.name.replace(/[[\]\n]/g, " ").trim();
    const nextPicked = new Map(picked);
    nextPicked.set(name, user.id);
    setPicked(nextPicked);
    const inserted = `@${name} `;
    const nextDisplay = display.slice(0, trigger.start) + inserted + display.slice(caret);
    emit(nextDisplay, nextPicked);
    setTrigger(null);
    const position = trigger.start + inserted.length;
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[active]);
        return;
      }
    }
    if (event.key === "Escape" && trigger) {
      event.preventDefault();
      setTrigger(null);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && value.trim() && !submitting) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={textareaRef}
        value={display}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="min-h-20 resize-y"
        onChange={(event) => {
          emit(event.target.value);
          detectTrigger(event.target.value, event.target.selectionEnd ?? event.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onClick={(event) => detectTrigger(event.currentTarget.value, event.currentTarget.selectionEnd ?? 0)}
        onBlur={() => setTimeout(() => setTrigger(null), 150)}
      />
      {trigger && (
        <div
          role="listbox"
          aria-label="Mention a user"
          className="bg-popover text-popover-foreground absolute left-0 z-20 mt-1 w-72 rounded-md border p-1 shadow-md"
        >
          {suggestions.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-xs">No users match.</div>
          ) : (
            suggestions.map((user, index) => (
              <button
                key={user.id}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(user)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <span>{user.name}</span>
                {user.email && <span className="text-muted-foreground text-xs">{user.email}</span>}
              </button>
            ))
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">{leading}</div>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onSubmit} disabled={!value.trim() || submitting}>
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A comment body with each mention shown as a chip, named from the current user list. */
export function MentionText({ body, nameById }: { body: string; nameById: Map<string, string> }) {
  const parts = useMemo(() => splitMentions(body), [body]);
  return (
    <p className="mt-2 text-sm whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <Badge key={index} variant="secondary" className="mx-0.5 align-baseline font-normal">
            @{nameById.get(part.userId) ?? part.name}
          </Badge>
        ),
      )}
    </p>
  );
}
