"use client";

// TEMPORARY: measures where html2canvas draws the brochure's text inside its
// boxes, to set the PDF padding correction. Delete after.
import { useState } from "react";
import html2canvas from "html2canvas";

import { readAmcBrochureCopy } from "@/components/dashboard/extensions/amc/amc-brochure";
import { AmcBrochurePage } from "@/components/dashboard/extensions/amc/templates/amc-doc/AmcBrochurePage";
import { sanitizeUnsupportedColors } from "@/lib/pdf/sanitize-colors";

const BROCHURE = {
  copy: readAmcBrochureCopy(undefined),
  reference: "AMC-2026-6891",
  issued: "28/09/2026",
  customerName: "Abel Kirkland",
  contactPerson: "Stuart Huffman",
  accountManagers: ["Alexander Shields", "Geraldine Byrd"],
  propertyLabel: "Rerum et aperiam exp — 739 West Fabien Avenue",
  propertyType: "COMMERCIAL - APARTMENT",
  coverageMonths: 12,
  startLabel: "28/09/2026",
  annualFee: 1040381,
  monthlyFee: 86698.42,
  paymentTerms: "Monthly",
  services: [
    { label: "Electrical PPM", detail: "100 per year · 42 units" },
    { label: "Plumbing PPM", detail: "77 per year · 66 units" },
    { label: "Water Pump Maintenance", detail: "72 per year · 41 units" },
  ],
};

type Box = { x: number; y: number; w: number; h: number };

export default function Check() {
  const [pdf, setPdf] = useState(false);
  const [result, setResult] = useState("");

  async function measure() {
    const page = document.querySelector<HTMLElement>("#subject [data-amc-page]")!;
    await document.fonts.ready;
    const S = 2;
    const canvas = await html2canvas(page, {
      useCORS: true,
      background: "#ffffff",
      logging: false,
      ...({ scale: S, onclone: (doc: Document) => sanitizeUnsupportedColors(doc) } as object),
    });
    const ctx = canvas.getContext("2d")!;
    const origin = page.getBoundingClientRect();
    const rel = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    };
    /* Ink rows inside a box (CSS px), ignoring an inset for borders. */
    const ink = (b: Box, inset = 3) => {
      const x0 = Math.round((b.x + inset) * S), y0 = Math.round((b.y + inset) * S);
      const w = Math.round((b.w - inset * 2) * S), h = Math.round((b.h - inset * 2) * S);
      const data = ctx.getImageData(x0, y0, w, h).data;
      const bg = [data[0], data[1], data[2]];
      let top = -1, bottom = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 120) {
            if (top < 0) top = y;
            bottom = y;
            break;
          }
        }
      }
      return { top: b.y + inset + top / S, bottom: b.y + inset + bottom / S };
    };
    const gaps = (el: Element | null | undefined) => {
      if (!el) return "missing";
      const b = rel(el);
      const i = ink(b);
      return { top: +(i.top - b.y).toFixed(1), bottom: +(b.y + b.h - i.bottom).toFixed(1) };
    };
    const find = (text: string) =>
      [...page.querySelectorAll<HTMLElement>("div,span")].find((el) => el.textContent?.trim() === text && el.children.length === 0);

    const out: Record<string, unknown> = {};
    out.button = gaps(find(BROCHURE.copy.cta));
    out.pill = gaps(find(BROCHURE.propertyType));
    const banner = find(BROCHURE.copy.heroTitle[0])?.parentElement;
    out.banner = gaps(banner);
    const coverage = find("Coverage")?.parentElement;
    out.coverageCard = gaps(coverage);
    const prepared = find("PREPARED FOR")?.parentElement;
    out.preparedCard = gaps(prepared);
    /* Icons beside text: text ink centre minus icon centre (+ = text lower). */
    const iconOffset = (img: HTMLImageElement | null | undefined, textEl: Element | null | undefined) => {
      if (!img || !textEl) return "missing";
      const ib = rel(img);
      const tb = rel(textEl);
      const band: Box = { x: tb.x, y: Math.min(ib.y, tb.y) - 4, w: tb.w, h: Math.max(ib.h, tb.h) + 8 };
      const t = ink(band, 0);
      return +(((t.top + t.bottom) / 2) - (ib.y + ib.h / 2)).toFixed(1);
    };
    const contactSpans = [...page.querySelectorAll("img")].filter((img) => (img.getAttribute("src") ?? "").includes("icon-phone"));
    const phone = contactSpans[0];
    const phoneText = phone?.parentElement ? [...phone.parentElement.childNodes].find((n) => n.nodeType === 3) : null;
    let phoneTextBox: Element | null = find(BROCHURE.copy.contact[0]) ?? null;
    if (!phoneTextBox && phoneText) {
      const span = document.createElement("span");
      phoneText.parentNode!.insertBefore(span, phoneText);
      span.appendChild(phoneText);
      phoneTextBox = span;
    }
    out.contactIcon = iconOffset(phone, phoneTextBox);
    const tick = [...page.querySelectorAll("img")].find((img) => (img.getAttribute("src") ?? "").includes("icon-tick")) as HTMLImageElement | undefined;
    const label = find(BROCHURE.services[0].label);
    out.tick = iconOffset(tick, label);

    /*
      How far html2canvas draws each text below where the browser does:
      measured ink top minus where Lato's caps sit in the line box
      (ascent 0.987em, cap height 0.7165em, content area 1.2em).
    */
    const drop = (el: Element | null | undefined) => {
      if (!el) return "missing";
      const b = rel(el);
      const cs = getComputedStyle(el as HTMLElement);
      const fs = parseFloat(cs.fontSize);
      const lh = cs.lineHeight === "normal" ? fs * 1.2 : parseFloat(cs.lineHeight);
      const padTop = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
      const expected = b.y + padTop + (lh - 1.2 * fs) / 2 + (0.987 - 0.7165) * fs;
      const i = ink({ x: b.x, y: b.y, w: b.w, h: b.h }, 0);
      const d = i.top - expected;
      return { fs, lh, drop: +d.toFixed(1), perEm: +(d / fs).toFixed(3) };
    };
    const tagline = find(BROCHURE.copy.heroTitle[1])?.nextElementSibling;
    out.drops = {
      headline: drop(find(BROCHURE.copy.heroTitle[0])),
      tagline: drop(tagline),
      planTitle: drop(find("Your plan")),
      cardTitle: drop(find("Coverage")),
      customer: drop(find(BROCHURE.customerName)),
      preparedFor: drop(find("PREPARED FOR")),
      service: drop(find(BROCHURE.services[0].label)),
      cta: drop(find(BROCHURE.copy.cta)),
      intro: drop(find(BROCHURE.copy.introTitle)),
    };
    setResult(JSON.stringify(out));
  }

  return (
    <div>
      <button id="raw" onClick={() => setPdf(false)}>raw</button>
      <button id="pdf" onClick={() => setPdf(true)}>pdf</button>
      <button id="measure" onClick={() => void measure()}>measure</button>
      <button
        id="dump"
        onClick={async () => {
          const { generateBrandedPdfBlob } = await import("@/components/dashboard/extensions/amc/amc-pdf-utils");
          const blob = await generateBrandedPdfBlob({ documentType: "proposal", blocks: [], brochure: BROCHURE }, { cover: true, scale: 2 });
          const r = await fetch("/api/dev-brochure-dump", { method: "POST", body: blob }).then((x) => x.json());
          setResult(JSON.stringify(r));
        }}
      >
        dump
      </button>
      <pre id="result">{result}</pre>
      <div id="subject" style={{ position: "absolute", left: -9999, top: 0 }}>
        <AmcBrochurePage brochure={BROCHURE} pdf={pdf} />
      </div>
    </div>
  );
}
