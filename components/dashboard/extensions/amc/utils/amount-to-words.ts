import { toFils } from "@/lib/amc/pricing";

const ONES = [
  "",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
];

const TENS = [
  "",
  "",
  "TWENTY",
  "THIRTY",
  "FORTY",
  "FIFTY",
  "SIXTY",
  "SEVENTY",
  "EIGHTY",
  "NINETY",
];

const SCALES = ["", "THOUSAND", "MILLION", "BILLION", "TRILLION"];

function chunkToWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
  }

  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  const hundredPart = `${ONES[hundreds]} HUNDRED`;
  const remainderPart = chunkToWords(remainder);
  return remainderPart ? `${hundredPart} ${remainderPart}` : hundredPart;
}

function integerToWords(n: number): string {
  if (n === 0) return "ZERO";

  const parts: string[] = [];
  let remaining = n;
  let scaleIndex = 0;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkWords = chunkToWords(chunk);
      const scale = SCALES[scaleIndex];
      parts.unshift(scale ? `${chunkWords} ${scale}` : chunkWords);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex += 1;
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/*
  Read from whole fils, the same integer the printed figure is formatted
  from (lib/amc/pricing.ts). Splitting the float instead could give a fil
  value of 100 ("ONE HUNDRED FILS" next to "1.00") or one fil off the
  figure beside it.
*/
export function amountToWordsAed(amount: number): string {
  const totalFils = Number.isFinite(amount) ? Math.max(0, toFils(amount)) : 0;
  const dirhams = Math.floor(totalFils / 100);
  const fils = totalFils % 100;

  const dirhamWords = integerToWords(dirhams);
  const filsWords = fils > 0 ? ` AND ${integerToWords(fils)} FILS` : "";

  return `${dirhamWords} DIRHAMS${filsWords} ONLY (VAT INCLUDED)`;
}
