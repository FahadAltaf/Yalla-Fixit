import { CLIENT_PHONE_REQUIRED, isUsablePhone } from "@/lib/snagging/client-phone";

/**
 * What a client must have to be saved, in one place for the Clients
 * dialog and its API (26 Nov 2026: one Edit client for AMC and Snagging).
 *
 * Zoho FSM keeps every client with an email, so it is required whenever the
 * client is saved there; the phone is required everywhere (SNG-008). The
 * Maher ID is optional (26 Nov 2026, the user: not required when a client is
 * created); it is sent to FSM when given.
 */
export type ClientContactInput = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  maherId: string | null;
  notes: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value: string | null | undefined) => Boolean(value && EMAIL.test(value.trim()));

const clean = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
};

/** The contact fields from a request body, trimmed, blanks as null. */
export function readContactInput(body: unknown): ClientContactInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    name: clean(b.name) ?? "",
    email: clean(b.email),
    phone: clean(b.phone),
    company: clean(b.company),
    maherId: clean(b.maherId),
    notes: clean(b.notes),
  };
}

/** The first thing stopping this client being saved, or null. */
export function contactProblem(input: ClientContactInput, opts: { savedInFsm: boolean }): string | null {
  if (input.name.length < 2) return "A name needs at least two characters.";
  if (!isUsablePhone(input.phone)) return CLIENT_PHONE_REQUIRED;
  if (input.email && !isEmail(input.email)) return "Enter a full email address.";
  if (opts.savedInFsm && !input.email) return "An email is required: Zoho FSM keeps every client with one.";
  return null;
}
