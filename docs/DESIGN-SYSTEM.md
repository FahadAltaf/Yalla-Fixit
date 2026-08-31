# Kaizen design system in the portal

The portal follows the **Kaizen Unit Management design system**: brand red
on neutral greys, Lexend headings over Source Sans 3 body, pill buttons,
soft rounded cards, generous whitespace.

## How it is wired

The system's tokens are declared in [app/globals.css](../app/globals.css)
as `--kz-*`, then **mapped onto the shadcn token names** the components
already consume. Nothing was renamed, so every existing component picked
the brand up without being edited, and a token change lands in one place.

| Kaizen | shadcn role | Value |
|---|---|---|
| brand | `--primary`, `--ring`, `--sidebar-primary` | `#8C1D24` |
| brand-50 | `--accent`, `--sidebar-accent` | `#FBF2F3` |
| ink | `--foreground`, `--card-foreground` | `#16181A` |
| ink-soft | `--muted-foreground` | `#3F4347` |
| mist-soft | `--muted`, `--secondary`, `--sidebar` | `#F4F5F4` |
| hairline (ink 9%) | `--border` | `color-mix(...)` |
| card radius | `--radius` | `14px` |

The palette is also exposed as Tailwind utilities for the cases where a
component needs the source colour rather than its shadcn role:
`bg-brand`, `bg-brand-50`, `text-ink-soft`, `bg-mist-soft`,
`text-success`, `text-warning`, `text-danger`.

## Rules applied

- **Type.** Lexend 600/700 on every heading with `-0.02em` tracking, set
  on the elements themselves so a heading is correct by default. Source
  Sans 3 body at 1.6 line-height. Figures are tabular.
- **Shape.** Buttons are pills, cards 14px with a hairline border and a
  soft resting shadow, inputs and textareas 12px, badges pills.
- **Icons.** Lucide at stroke-width 1.75. `lucide-react` writes the
  stroke as a presentation attribute, which any CSS declaration
  outranks, so one rule in `globals.css` covers the whole app.
- **Motion.** 150-200ms on `cubic-bezier(0.16, 1, 0.3, 1)`. The
  `.kz-card-interactive` helper does the 2px hover lift with a neutral
  shadow and a border that warms toward brand. It respects
  `prefers-reduced-motion`.
- **Eyebrows.** The `.eyebrow` utility: uppercase, 0.14em tracking,
  semibold, brand red. Used above each page title.
- **Voice.** Sentence case, no em dashes, "you" and "we". The em dash
  rule was applied to user-facing copy in the snagging module. The `—`
  still used in table cells for an empty value is a table convention
  rather than sentence punctuation, so it stayed.

## Deliberate extensions

The source system was built for a marketing site and defines one
semantic colour (success green). A management dashboard has to show
severity and breached deadlines, so two were added:
`--kz-warning: #B45309` and `--kz-danger: #B91C1C`. Brand red was not
reused for danger, because that would make "approve" and "delete" read
identically.

Dark mode extends the system's one dark motif (the near-black `#16181A`
band with white text and brand-200 accents) rather than inventing a
second palette. Brand red at full strength is unreadable on ink, so
accents step up to a lighter tint there.

## One thing to know

`ThemeContext` writes `--primary` as an **inline style on `<html>`** from
`settings.primary_color`, which outranks the stylesheet. The coded
default is now the Kaizen brand red, and "Kaizen Red" is the first swatch
in **Settings → Appearance**.

If the settings row holds a different red, that value wins over the
design system at runtime. To align it, pick Kaizen Red in Settings →
Appearance, or:

```sql
update public.settings set primary_color = '#8C1D24' where id = 1;
```
