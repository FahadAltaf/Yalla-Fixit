/**
 * Who a Finance or Reports message may actually reach.
 *
 * This branch is developed against the production database, with real
 * coordinators, real technicians and real Finance staff in `user_profile`.
 * A digest, a missed-check-in alert or a compliance statement built during
 * development is addressed to those real people. Sending it would put a
 * fake penalty in a technician's inbox.
 *
 * So every E1–E3 email and N1–N14 notification passes through this policy,
 * and the policy fails CLOSED:
 *
 *   live      FINANCE_NOTIFY_LIVE=on        everyone it is addressed to
 *   redirect  NOTIFY_REDIRECT_TO=<address>  email to that one address only;
 *                                           in-app only to NOTIFY_INAPP_ALLOWLIST
 *   blocked   neither set                   nothing is sent at all
 *
 * "Blocked" is the default on purpose. A deployment that has not been told
 * where to send things sends nothing, rather than guessing. Live is the
 * production setting and is never set on a development machine.
 *
 * The functions are pure (environment in, decision out) so the rules are
 * tested without sending anything.
 */

export type DeliveryMode = "live" | "redirect" | "blocked";

export function deliveryMode(env: NodeJS.ProcessEnv = process.env): DeliveryMode {
  if (env.FINANCE_NOTIFY_LIVE === "on") return "live";
  if (redirectAddress(env)) return "redirect";
  return "blocked";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function redirectAddress(env: NodeJS.ProcessEnv): string | null {
  const value = (env.NOTIFY_REDIRECT_TO ?? "").trim();
  return EMAIL.test(value) ? value : null;
}

export type EmailDelivery =
  | { send: true; to: string[]; subject: string; redirectedFrom: string[] | null }
  | { send: false; reason: string };

/**
 * Where an email goes, and what its subject says.
 *
 * In redirect mode the intended recipients are kept (`redirectedFrom`) so
 * the message can say who it was really for: a tester reading a digest
 * needs to know whether it was meant for Finance or for a coordinator.
 */
export function planEmail(
  input: { to: string[]; subject: string },
  env: NodeJS.ProcessEnv = process.env,
): EmailDelivery {
  const intended = [...new Set(input.to.map((a) => a.trim()).filter(Boolean))];
  if (intended.length === 0) return { send: false, reason: "no recipients" };

  const mode = deliveryMode(env);
  if (mode === "live") {
    return { send: true, to: intended, subject: input.subject, redirectedFrom: null };
  }
  if (mode === "redirect") {
    return {
      send: true,
      to: [redirectAddress(env) as string],
      subject: `[DEV] ${input.subject}`,
      redirectedFrom: intended,
    };
  }
  return {
    send: false,
    reason: "delivery is blocked: set NOTIFY_REDIRECT_TO for development, or FINANCE_NOTIFY_LIVE=on in production",
  };
}

/** The user ids an in-app notification may be written for, and those it may not. */
export function planInApp(
  userIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): { deliver: string[]; suppressed: string[] } {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (deliveryMode(env) === "live") return { deliver: unique, suppressed: [] };

  // Outside live mode, only explicitly listed test users ever see one. In
  // "blocked" mode the list is still honoured: in-app rows cannot leave the
  // portal, so a named developer account is safe either way.
  const allow = new Set(
    (env.NOTIFY_INAPP_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    deliver: unique.filter((id) => allow.has(id)),
    suppressed: unique.filter((id) => !allow.has(id)),
  };
}
