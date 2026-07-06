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

const SCALES = ["", "THOUSAND", "MILLION", "BILLION"];

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

export function amountToWordsAed(amount: number): string {
  const safeAmount = Math.max(0, amount);
  const dirhams = Math.floor(safeAmount);
  const fils = Math.round((safeAmount - dirhams) * 100);

  const dirhamWords = integerToWords(dirhams);
  const filsWords = fils > 0 ? ` AND ${integerToWords(fils)} FILS` : "";

  return `${dirhamWords} DIRHAMS${filsWords} ONLY (VAT INCLUDED)`;
}
