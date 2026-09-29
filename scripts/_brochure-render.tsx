/* Throwaway: render the proposal's page to a static HTML file to look at. */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { AmcBrochurePage } from "@/components/dashboard/extensions/amc/templates/amc-doc/AmcBrochurePage";
import { readAmcBrochureCopy } from "@/components/dashboard/extensions/amc/amc-brochure";

const brochure = {
  copy: readAmcBrochureCopy(undefined),
  reference: "AMC-2026-0042",
  issued: "29/09/2026",
  customerName: "Sami Farah",
  contactPerson: "Sami Farah",
  accountManagers: ["Danish Ali"],
  propertyLabel: "Villa 123 — Full Adress 123, st 1",
  propertyType: "Residential - Villa",
  coverageMonths: 12,
  startLabel: "29/09/2026",
  annualFee: 3500,
  monthlyFee: 292,
  paymentTerms: "Annual",
  services: [
    { label: "24/7 Technical Support Hotline", units: 3, frequency: "Covered" },
    { label: "Planned Preventive Maintenance ~ Electrical Service", units: 5, frequency: "2 per year" },
    { label: "Planned Preventive Maintenance ~ Water Pump Service", units: 2, frequency: "2 per year" },
    { label: "Air Conditioning Preventive Maintenance", units: 4, frequency: "4 per year" },
    { label: "Plumbing Inspection", units: 1, frequency: "2 per year" },
  ],
};

const html = renderToStaticMarkup(
  <AmcBrochurePage brochure={brochure as never} />,
);

const out = path.join(process.cwd(), "scripts", "_brochure.html");
fs.writeFileSync(
  out,
  `<!doctype html><html><head><meta charset="utf-8">
<title>Proposal page</title>
<style>body{margin:0;background:#4a4a4a;padding:24px;font-family:Lato,system-ui,sans-serif}
.page{margin:0 auto;box-shadow:0 8px 32px rgba(0,0,0,.4)}</style>
</head><body><div class="page">${html}</div></body></html>`,
);
console.log(out);
