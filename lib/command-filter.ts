/**
 * How every searchable list (cmdk `Command`) decides what matches.
 *
 * cmdk's own filter is a fuzzy score against each item's `value`. Two
 * things went wrong with that:
 *
 *  - Pickers keyed by id (the inspector picker, the role and settings
 *    selects) give each row its id as the value, so the search was run
 *    against a uuid. Typing "A" kept everyone whose ID happened to contain
 *    an "a" and the names on screen had nothing to do with what was typed.
 *  - Fuzzy means "these letters, in this order, anywhere", so "ali" also
 *    kept "Jonathan Parecto Li…"-shaped names. A staff list wants the
 *    plain thing: the rows that contain what was typed.
 *
 * So: a row is searched by its `keywords` (the text the user can see)
 * when it has any, by its value otherwise, and it matches when it contains
 * every word typed, in any order, ignoring case and accents. Rows that
 * start with the search come first, then rows where a word does.
 */
export function matchLabel(value: string, search: string, keywords?: string[]): number {
  const needle = normalise(search);
  if (!needle) return 1;

  const shown = (keywords ?? []).filter(Boolean).join(" ");
  const haystack = normalise(shown || value);
  if (!haystack) return 0;

  const terms = needle.split(" ");
  if (!terms.every((term) => haystack.includes(term))) return 0;

  if (haystack.startsWith(needle)) return 1;
  const words = haystack.split(" ");
  if (terms.every((term) => words.some((word) => word.startsWith(term)))) return 0.8;
  return 0.5;
}

/** Lower-cased, accents removed, runs of spaces collapsed. */
function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
