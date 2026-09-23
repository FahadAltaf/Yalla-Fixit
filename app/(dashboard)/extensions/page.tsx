import { redirect } from "next/navigation";

/**
 * /extensions has no page of its own any more: each extension has its own
 * address, listed under Extensions in the sidebar.
 *
 * The old addresses kept everything in the query string
 * (?section=amc-proposals&view=submissions&review=<id>), and those links
 * are still out there -- in the approval bell, in bookmarks, in messages
 * people sent each other. They land on the page they meant rather than on
 * a 404.
 */
export default async function ExtensionsIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  switch (one("section")) {
    case "quotation-templates":
      redirect("/extensions/quotation-templates");
    case "amc-settings":
      redirect("/settings/amc");
    case "amc-proposals": {
      const review = one("review");
      if (review) redirect(`/extensions/amc/${encodeURIComponent(review)}`);
      const submission = one("submission");
      if (submission) {
        const step = one("step");
        redirect(
          `/extensions/amc/${encodeURIComponent(submission)}/edit${step ? `?step=${encodeURIComponent(step)}` : ""}`,
        );
      }
      if (one("view") === "create") redirect("/extensions/amc/new");
      // "Waiting for approval" is the Awaiting approval status filter now.
      const scope = one("scope");
      redirect(
        scope === "waiting"
          ? "/extensions/amc?status=awaiting_approval"
          : scope === "mine"
            ? "/extensions/amc?scope=mine"
            : "/extensions/amc",
      );
    }
    default:
      redirect("/extensions/bulk-download");
  }
}
