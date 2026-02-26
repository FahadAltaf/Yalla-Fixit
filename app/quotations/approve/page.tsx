import type { Metadata } from "next";
import { redirect } from "next/navigation";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.yallafixit.ae";

export const metadata: Metadata = {
  title: "Approve quotation | Yalla Fixit",
  description:
    "View and confirm your Yalla Fixit quotation. Review the summary, service address, and total amount before approval.",
  alternates: {
    canonical: `${APP_URL}/quotations/review`,
  },
  openGraph: {
    title: "Approve your Yalla Fixit quotation",
    description:
      "Securely review and approve your quotation from Yalla Fixit, including service details and full pricing summary.",
    url: `${APP_URL}/quotations/review`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Approve your Yalla Fixit quotation",
    description:
      "Securely review and approve your quotation from Yalla Fixit, including service details and full pricing summary.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

interface PageProps {
  searchParams?: {
    quotationNumber?: string;
  };
}

export default function ApproveQuotationPage({ searchParams }: PageProps) {
  const quotationNumber = searchParams?.quotationNumber ?? "";
  const target = `/quotations/review${
    quotationNumber ? `?quotationNumber=${encodeURIComponent(quotationNumber)}&intent=approve` : ""
  }`;

  redirect(target);
}
