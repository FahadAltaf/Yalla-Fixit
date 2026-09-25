"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, List, ListOrdered } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type QuoteEditorTool =
  | "heading"
  | "subheading"
  | "bullet"
  | "number"
  | "bold";

/**
 * The quotation wording, edited as it prints (point 14).
 *
 * It used to be a textarea of raw markers, with the formatting explained
 * in a hint underneath -- so the one thing an admin needed to see, which
 * of these lines is a heading, was the one thing the box could not show.
 * Here a heading looks like a heading.
 *
 * The editor works in HTML; `lib/snagging/quote-editor.ts` converts to and
 * from the stored dialect, because the PDF and the Word file are built by
 * parsing that dialect and cannot read HTML. That module's round-trip is
 * covered by a check against the wording actually in the database.
 */
export function QuoteRichText({
  value,
  onChange,
  tools,
  placeholder,
  ariaLabel,
}: {
  /** HTML, from scopeToHtml / termsToHtml. */
  value: string;
  /** HTML, for htmlToScope / htmlToTerms. */
  onChange: (html: string) => void;
  tools: QuoteEditorTool[];
  placeholder?: string;
  ariaLabel: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Only what the stored dialect can express. A blockquote or a code
        // block would be silently dropped on save, which is worse than
        // never offering it.
        heading: { levels: [1, 2] },
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: false,
      }),
    ],
    content: value,
    // Next renders this on the server first; TipTap has to wait for the
    // client or the two disagree about the DOM.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: cn(
          "min-h-[14rem] max-h-[26rem] overflow-y-auto rounded-b-[12px] border border-t-0 px-3 py-2.5",
          "prose-sm max-w-none focus:outline-none",
          "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold",
          "[&_h2]:mt-2.5 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold",
          "[&_p]:my-1 [&_p]:text-sm",
          "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li]:text-sm [&_li>p]:my-0",
        ),
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  /*
    Only when the two genuinely differ.

    The dialog reopens with content built from the saved dialect, which is
    not character-identical to what the editor last emitted (a sub-heading
    gains its `##`). Setting it back unconditionally on every render would
    fight the person typing.
  */
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="border-border h-[17rem] animate-pulse rounded-[12px] border" />
    );
  }

  return (
    <div>
      <Toolbar editor={editor} tools={tools} />
      <EditorContent editor={editor} />
      {placeholder && editor.isEmpty ? (
        <p className="text-muted-foreground mt-1 text-xs">{placeholder}</p>
      ) : null}
    </div>
  );
}

function Toolbar({
  editor,
  tools,
}: {
  editor: Editor;
  tools: QuoteEditorTool[];
}) {
  const items: Record<
    QuoteEditorTool,
    { label: string; icon: typeof Bold; active: boolean; run: () => void }
  > = {
    heading: {
      label: "Heading",
      icon: Heading1,
      active: editor.isActive("heading", { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    subheading: {
      label: "Sub-heading",
      icon: Heading2,
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    bullet: {
      label: "Bullet",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    number: {
      label: "Numbered",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    bold: {
      label: "Bold",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
  };

  return (
    <div className="border-border bg-muted/30 flex flex-wrap items-center gap-1 rounded-t-[12px] border px-1.5 py-1.5">
      {tools.map((tool) => {
        const item = items[tool];
        const Icon = item.icon;
        return (
          <Button
            key={tool}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={item.active}
            onClick={item.run}
            className={cn(
              "h-7 gap-1.5 px-2 text-xs",
              item.active && "bg-brand-50 text-brand",
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
