import type { Metadata } from "next";
import { redirect } from "next/navigation";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://www.yallafixit.ae";

export const metadata: Metadata = {
  title: "Reject quotation | Yalla Fixit",
  description:
    "Let Yalla Fixit know that you do not wish to proceed with this quotation. Review the summary and submit your rejection.",
  alternates: {
    canonical: `${APP_URL}/quotations/review`,
  },
  openGraph: {
    title: "Reject your Yalla Fixit quotation",
    description:
      "Securely review and reject your quotation from Yalla Fixit if it does not match your requirements.",
    url: `${APP_URL}/quotations/review`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reject your Yalla Fixit quotation",
    description:
      "Securely review and reject your quotation from Yalla Fixit if it does not match your requirements.",
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

export default function RejectQuotationPage({ searchParams }: PageProps) {
  const quotationNumber = searchParams?.quotationNumber ?? "";
  const target = `/quotations/review${
    quotationNumber ? `?quotationNumber=${encodeURIComponent(quotationNumber)}&intent=reject` : ""
  }`;

  redirect(target);
}
