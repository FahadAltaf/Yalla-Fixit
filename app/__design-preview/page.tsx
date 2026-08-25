import { QuotationLinesTable } from "@/components/dashboard/snagging/quotation-lines-table";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { QuotationStatusBadge } from "@/components/dashboard/snagging/shared";

/**
 * TEMPORARY design harness — delete before shipping.
 *
 * Renders the quotation block against a fixture so the layout can be
 * looked at without a login or a seeded job.
 */
export default function DesignPreviewPage() {
  return (
    <div className="bg-background min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <SectionCard
          title="Quotation"
          description="Quotation QT-2026-0042"
          action={<QuotationStatusBadge status="sent" />}
          bodyClassName="border-t"
        >
          <div className="space-y-5 p-5">
            <QuotationLinesTable
              lines={[
                {
                  description: "Snagging inspection — Apartment, 2 BR (55 sq ft)",
                  qty: 55,
                  unit: "sq ft",
                  unit_price: 1,
                  amount: 55,
                },
              ]}
              currency="AED"
              subtotal={55}
              taxRate={5}
              taxAmount={2.75}
              total={57.75}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Quotation (multi-line)"
          description="Quotation QT-2026-0043"
          action={<QuotationStatusBadge status="approved" />}
          bodyClassName="border-t"
        >
          <div className="space-y-5 p-5">
            <QuotationLinesTable
              lines={[
                {
                  description: "Snagging inspection — Villa, 4 BR (3,200 sq ft)",
                  qty: 3200,
                  unit: "sq ft",
                  unit_price: 1.25,
                  amount: 4000,
                },
                {
                  description: "External areas — garden and boundary wall",
                  qty: 900,
                  unit: "sq ft",
                  unit_price: 0.75,
                  amount: 675,
                },
                {
                  description: "De-snag round (second visit)",
                  qty: 1,
                  unit: "visit",
                  unit_price: 450,
                  amount: 450,
                },
              ]}
              currency="AED"
              subtotal={5125}
              taxRate={5}
              taxAmount={256.25}
              total={5381.25}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
