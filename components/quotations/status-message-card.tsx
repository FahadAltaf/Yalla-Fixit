import type { ReactNode } from "react";

/**
 * Terminal-state card for the two public quotation pages.
 *
 * Extracted from app/quotations/review so /quote/[token] can use the very
 * same component rather than a look-alike -- two copies would drift the
 * moment either page is touched, and these are the only pages a client ever
 * sees of the portal.
 */
export function StatusMessageCard({
  title,
  description,
  icon,
  iconBg,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  iconBg: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-gray-100 bg-white px-8 py-10 text-center shadow-sm">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full ${iconBg}`}>
          {icon}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <p className="text-sm leading-relaxed text-gray-500">{description}</p>
        </div>
      </div>
    </main>
  );
}
