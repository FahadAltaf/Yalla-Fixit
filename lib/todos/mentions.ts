/*
  FR-17: how a mention is written into a comment's text.

  A comment body carries one token per mention, `@[Display Name](uuid)`,
  so the server can store who was mentioned as data (todo_comment_mentions)
  and the screen can render a chip without trusting the name in the token:
  it resolves the uuid to the current name. Shared by the composer, the
  renderer and the comments route; no dependencies, safe in the browser.
*/

// A strict uuid, so a malformed id never reaches a uuid column and fails the save.
export const MENTION_TOKEN =
  /@\[([^\]\n]{1,120})\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export type MentionPart = { kind: "text"; text: string } | { kind: "mention"; userId: string; name: string };

export function mentionToken(name: string, userId: string): string {
  // Square brackets and newlines would break the token, so they are dropped
  // from the name; the uuid is what identifies the person.
  return `@[${name.replace(/[[\]\n]/g, " ").trim()}](${userId})`;
}

/** The distinct user ids mentioned in a body, in order of first appearance. */
export function extractMentionIds(body: string): string[] {
  const ids: string[] = [];
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = match[2].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Splits a body into text and mention parts for rendering. */
export function splitMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: body.slice(last, start) });
    parts.push({ kind: "mention", userId: match[2].toLowerCase(), name: match[1] });
    last = start + match[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}

/** The body as plain words, for emails and previews: `@Name` for each mention. */
export function mentionsToPlainText(body: string): string {
  return body.replace(MENTION_TOKEN, (_match, name: string) => `@${name}`);
}
