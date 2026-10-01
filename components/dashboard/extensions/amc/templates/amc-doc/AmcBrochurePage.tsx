/* eslint-disable @next/next/no-img-element -- this page is captured by
   html2canvas for the PDF and the Word file, which needs plain <img>. */
import type { CSSProperties, ReactNode } from "react";
import { Lato } from "next/font/google";

import iconCallouts from "@/public/amc/brand/brochure/icon-callouts.png";
import iconCertified from "@/public/amc/brand/brochure/icon-certified.png";
import iconDiscounts from "@/public/amc/brand/brochure/icon-discounts.png";
import iconGlobe from "@/public/amc/brand/brochure/icon-globe.png";
import iconManager from "@/public/amc/brand/brochure/icon-manager.png";
import iconPhone from "@/public/amc/brand/brochure/icon-phone.png";
import iconResponse from "@/public/amc/brand/brochure/icon-response.png";
import iconSupport from "@/public/amc/brand/brochure/icon-support.png";
import iconTick from "@/public/amc/brand/brochure/icon-tick.png";
import iconWhatsapp from "@/public/amc/brand/brochure/icon-whatsapp.png";
import iso14001 from "@/public/amc/brand/brochure/iso-14001.png";
import iso45001 from "@/public/amc/brand/brochure/iso-45001.png";
import iso9001 from "@/public/amc/brand/brochure/iso-9001.png";
import logo from "@/public/amc/brand/brochure/logo.png";
import photoDining from "@/public/amc/brand/brochure/photo-dining.jpg";
import photoInterior from "@/public/amc/brand/brochure/photo-interior.jpg";
import photoVilla from "@/public/amc/brand/brochure/photo-villa.jpg";
import puzzle from "@/public/amc/brand/brochure/puzzle.png";

import type { AmcBrochure, AmcBrochureIcon } from "../../amc-brochure";
import { formatProposalFee } from "../../amc-proposal-content";
import { AMC_PAGE } from "./amc-doc-theme";

/*
  The proposal, drawn to the client's template (the "customer version" of
  the AMC brochure, 2026-09-28): one continuous page, as tall as it needs.

  Everything here is measured from that PDF, which is 1920 units wide; the
  page is 794px (210mm), so one template unit is 794/1920 px. Section
  heights, type sizes, colours and positions are the template's, rounded
  to an 8px spacing scale. Photos, logo, badges and icons are the
  template's own, extracted at full resolution (public/amc/brand/brochure).
*/

/* The template's typeface. Its PDF embeds the glyphs as Type 3 outlines
   with no name; the letterforms are Lato's. */
const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  display: "block",
});

/* Sampled from the template. */
const C = {
  red: "#AA282A",
  /* The plan strip's red, a touch lighter than the headings'. */
  plan: "#B03232",
  text: "#605D5D",
  /* The smaller second line under a service. */
  soft: "#8A8585",
  band: "#F9F9F9",
  line: "#E6E1E1",
  white: "#FFFFFF",
} as const;

/* The covered-plan table: its column heads, its group bands, its cells. */
const planHead = {
  padding: "7px 10px",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textAlign: "center",
  verticalAlign: "middle",
  color: C.text,
  backgroundColor: C.white,
  borderBottom: `1px solid ${C.line}`,
} as const;

const planCell = {
  padding: "8px 10px",
  fontSize: "11.5px",
  lineHeight: "15px",
  textAlign: "center",
  verticalAlign: "middle",
  borderBottom: `1px solid ${C.line}`,
} as const;

const W = AMC_PAGE.width;
/* One content width for every section: the template's 110-unit margin. */
const M = 48;

/*
  The photo strip, 28% of the page's width as in the template, cut into
  the template's three cells. Each photo now fills its cell outright
  (object-fit: fill) rather than being placed at an offset and clipped,
  so no cell can come out with a band of background down one side.
*/
const STRIP = 224;
const PHOTOS = [
  { image: photoInterior, alt: "Apartment interior", cell: 251 },
  { image: photoVilla, alt: "Villa exterior", cell: 292 },
  { image: photoDining, alt: "Restaurant with a marina view", cell: 251 },
].map((photo) => ({ ...photo, src: photo.image.src }));

const ISO = [
  { src: iso14001.src, alt: "ISO 14001:2015 certified" },
  { src: iso45001.src, alt: "ISO 45001:2018 certified" },
  { src: iso9001.src, alt: "ISO 9001:2015 certified" },
];

const ICONS: Record<AmcBrochureIcon, string> = {
  support: iconSupport.src,
  callouts: iconCallouts.src,
  response: iconResponse.src,
  certified: iconCertified.src,
  manager: iconManager.src,
  discounts: iconDiscounts.src,
};

/* The contact line's icons, in the order its items are written. */
const CONTACT_ICONS = [iconPhone.src, iconGlobe.src, iconWhatsapp.src];

/*
  html2canvas draws text lower than the browser does, and for Lato by an
  amount that grows with the size: measured on this page, 15px for the
  34px headline, 10px for a 20px heading, 7px for 12px text, 5px for 9px
  -- about 0.42 of the font size plus 1.2px. A fixed nudge cannot fix
  that: text of different sizes drifts apart (the tagline crowded the
  headline) and boxed labels sat on their bottom edge.

  So for the capture, each box and gap is set separately: less at the top
  and more at the bottom by the drop of the text inside it -- the same
  correction the contract body makes (AmcPdfRenderContext) -- and icons
  beside text move down to meet it. The screen is untouched.
*/
const dropFor = (fontSize: number) => Math.round(fontSize * 0.42 + 1.2);

/**
 * The proposal: the client's brochure, showing only the plan this client
 * chose. The continuous preview, the PDF and the Word file all draw this.
 * `pdf` is set when it is captured for the PDF or the Word file.
 */
export function AmcBrochurePage({ brochure, pdf = false }: { brochure: AmcBrochure; pdf?: boolean }) {
  const { copy } = brochure;
  /* How much lower the capture draws text of this size (0 on screen). */
  const d = (fontSize: number) => (pdf ? dropFor(fontSize) : 0);
  const px = (value: number) => `${value}px`;

  return (
    <div
      data-amc-page="cover"
      className={lato.className}
      style={{
        width: `${W}px`,
        backgroundColor: C.white,
        fontFamily: lato.style.fontFamily,
        color: C.text,
        lineHeight: 1.3,
        letterSpacing: "normal",
        boxSizing: "border-box",
      }}
    >
      {/* 1. Logo left, certificates right */}
      <div
        style={{
          height: "144px",
          padding: `0 ${M}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <img
          src={logo.src}
          alt="Yalla Fix It Facility Management"
          /* contain, not fill: a stretched wordmark is the wrong mark. */
          style={{ height: "64px", width: "auto", objectFit: "contain", display: "block" }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {ISO.map((badge) => (
              <img
                key={badge.src}
                src={badge.src}
                alt={badge.alt}
                style={{ height: "52px", width: "auto", objectFit: "contain", display: "block" }}
              />
            ))}
          </div>
          {brochure.reference || brochure.issued ? (
            <div style={{ fontSize: "9px", color: C.soft }}>
              {[brochure.reference ? `Proposal ${brochure.reference}` : null, brochure.issued ? `Issued ${brochure.issued}` : null]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          ) : null}
        </div>
      </div>

      {/* 2. Photos, edge to edge */}
      <div style={{ display: "flex", height: `${STRIP}px` }}>
        {PHOTOS.map((photo) => (
          <div
            key={photo.src}
            style={{ width: `${photo.cell}px`, height: `${STRIP}px`, overflow: "hidden" }}
          >
            <img
              src={photo.src}
              alt={photo.alt}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "fill",
                display: "block",
              }}
            />
          </div>
        ))}
      </div>

      {/* The red banner, over the bottom of the photos, rounded at the top */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: "-16px",
          borderRadius: "16px 16px 0 0",
          backgroundColor: C.red,
          color: C.white,
          textAlign: "center",
          padding: `${px(36 - d(34))} 48px ${px(28 + d(12))}`,
        }}
      >
        {copy.heroTitle.map((line, index) => (
          <div key={index} style={{ fontSize: "34px", fontWeight: 700, lineHeight: "38px" }}>
            {line}
          </div>
        ))}
        {copy.heroTagline.length ? (
          <div style={{ fontSize: "12px", fontWeight: 700, marginTop: px(16 + d(34) - d(12)), whiteSpace: "nowrap" }}>
            {copy.heroTagline.map((item, index) => (
              <span key={index}>
                {index > 0 ? <span style={{ padding: "0 8px" }}>|</span> : null}
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* 3. Introduction */}
      <div style={{ textAlign: "center", padding: `${px(40 - d(20))} ${M}px 0` }}>
        {copy.introTitle ? (
          <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: "26px", color: C.red }}>{copy.introTitle}</div>
        ) : null}
        {copy.introBody ? (
          <div style={{ fontSize: "12px", lineHeight: "17px", maxWidth: "568px", margin: `${px(16 + d(20) - d(12))} auto 0` }}>
            {copy.introBody}
          </div>
        ) : null}
      </div>

      {/* 4. Why choose: a 3x2 grid, the cells of a row the same height */}
      <div style={{ padding: `${px(40 - (d(17) - d(12)))} ${M}px ${px(40 + d(12))}`, textAlign: "center" }}>
        {copy.whyTitle ? (
          <div style={{ fontSize: "17px", fontWeight: 700, lineHeight: "22px", color: C.red }}>{copy.whyTitle}</div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            /* Cells in a row share its height; rows keep their own, so a short
               second row leaves no empty band under it. */
            columnGap: "16px",
            rowGap: px(44 + d(12)),
            marginTop: px(40 + d(17)),
          }}
        >
          {copy.why.map((item, index) => (
            <div key={index}>
              <div style={{ height: "38px", display: "flex", justifyContent: "center", alignItems: "flex-end" }}>
                <img
                  src={ICONS[item.icon]}
                  alt=""
                  style={{ maxHeight: "38px", height: "38px", width: "auto", objectFit: "contain", display: "block" }}
                />
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: "17px", color: C.red, marginTop: px(12 - d(13)) }}>
                {item.title}
              </div>
              <div style={{ fontSize: "12px", lineHeight: "16px", maxWidth: "212px", margin: "6px auto 0" }}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. The grey band, from the plan to the bottom of the page. 36px at
          its top: with the space above the heading it reads as 48. */}
      <div style={{ backgroundColor: C.band, padding: `${px(36 - d(20))} ${M}px 0` }}>
        {copy.planTitle ? (
          <div style={{ textAlign: "center", fontSize: "20px", fontWeight: 700, lineHeight: "26px", color: C.red }}>
            {copy.planTitle}
          </div>
        ) : null}

        {/*
          6. One strip: who it is for, their plan, coverage, payment.

          Four tiles with the band between them, not four panes sharing
          one edge. The row used to be hairline-apart and underscored in
          red, which left a stray rule running past two white cards that
          had no bottom border of their own, and sat the red customer
          block hard against the red plan card as a single slab. The gap
          separates the two reds and the rule is gone.
        */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "stretch",
            marginTop: px(32 + d(20)),
          }}
        >
          <div
            style={{
              flex: "0 0 226px",
              backgroundColor: C.plan,
              color: C.white,
              borderRadius: "10px",
              padding: `${px(20 - d(9))} 16px 20px`,
            }}
          >
            <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", opacity: 0.85 }}>PREPARED FOR</div>
            <div style={{ fontSize: "18px", fontWeight: 700, lineHeight: "22px", marginTop: px(Math.max(0, 4 - (d(18) - d(9)))) }}>{brochure.customerName}</div>
            <div style={{ fontSize: "10.5px", lineHeight: "14px", marginTop: px(4 + d(18) - d(10.5)) }}>{brochure.propertyLabel}</div>
            {brochure.propertyType ? (
              <div
                style={{
                  display: "inline-block",
                  marginTop: px(8 + d(10.5)),
                  border: "1px solid rgba(255,255,255,0.7)",
                  borderRadius: "999px",
                  padding: pdf ? `0 8px ${px(4 + 2 * (d(8.5) - 2))}` : "2px 8px",
                  fontSize: "8.5px",
                  fontWeight: 700,
                  lineHeight: pdf ? px(11 - 2 * (d(8.5) - 2)) : "11px",
                  letterSpacing: "0.04em",
                }}
              >
                {brochure.propertyType}
              </div>
            ) : null}
          </div>

          {/*
            The three figures share the room equally.

            The plan was a fixed 196px and the other two split whatever
            was left, so the row ran wide, wide, narrow, narrow and read
            as two pairs of unrelated cards. One width between them makes
            it one row. The title is two words for the same reason: at a
            third of the space "Annual Maintenance Contract" wrapped to
            three lines where "Coverage" and "Payment" sat on one.
          */}
          <PlanCard
            pdf={pdf}
            highlight
            title="Maintenance plan"
            value={
              <>
                <Small pdf={pdf}>AED </Small>
                <Big>{formatProposalFee(brochure.monthlyFee)}</Big>
                <Small pdf={pdf}> / Month</Small>
              </>
            }
            caption={`AED ${formatProposalFee(brochure.annualFee)} a year · excl. 5% VAT`}
          />
          <PlanCard
            pdf={pdf}
            title="Coverage"
            value={
              <>
                <Big>{brochure.coverageMonths}</Big>
                <Small pdf={pdf}> Months</Small>
              </>
            }
            caption={`From ${brochure.startLabel}`}
          />
          <PlanCard
            pdf={pdf}
            title="Payment"
            value={<Big>{brochure.paymentTerms}</Big>}
            /* The third tile held a word and nothing else, where the two
               beside it each said what their figure meant. */
            caption={`AED ${formatProposalFee(brochure.annualFee)} excl. VAT, ${
              brochure.paymentTerms.toLowerCase() === "annual"
                ? "in one payment"
                : "by instalment"
            }`}
          />
        </div>

        {/*
          Who to talk to, on both sides, with the number to ring.

          This named the first coordination contact and listed the account
          managers by name alone -- so a proposal naming a tenant and a
          representative printed one of them, and nobody on the page could
          be called off it.
        */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 28px",
            fontSize: "11px",
            lineHeight: "15px",
            marginTop: "12px",
          }}
        >
          {brochure.contacts.length ? (
            <div>
              <span style={{ fontWeight: 700 }}>
                Contact{brochure.contacts.length > 1 ? "s" : ""}:
              </span>{" "}
              {brochure.contacts
                .map((c) => [c.name, c.phone].filter(Boolean).join(" · "))
                .join("   |   ")}
            </div>
          ) : null}
          {brochure.accountManagers.length ? (
            <div>
              <span style={{ fontWeight: 700 }}>
                Account manager{brochure.accountManagers.length > 1 ? "s" : ""}:
              </span>{" "}
              {brochure.accountManagers
                .map((m) => [m.name, m.phone].filter(Boolean).join(" · "))
                .join("   |   ")}
            </div>
          ) : null}
        </div>

        {/* 7. What they chose is covered.

            No card around it: the table carries its own border, so a
            white panel behind it only boxed a box. The heading and the
            note now sit on the band like every other heading on the
            page. */}
        <div style={{ marginTop: "40px" }}>
          {copy.servicesTitle ? (
            /* Centred over its table, as "Your plan" is over the strip. */
            <div
              style={{
                textAlign: "center",
                fontSize: "20px",
                fontWeight: 700,
                lineHeight: "26px",
                color: C.red,
              }}
            >
              {copy.servicesTitle}
            </div>
          ) : null}
          {/*
            What the plan covers: a tick and the service, three across.

            This was briefly a four-column table with its own red header
            band. For three or four services that was a lot of furniture
            around very little -- a header row, a rule under every line
            and a column whose every cell said the same thing -- and it
            repeated the red band the plan strip above already uses. The
            list is back, with what the table was for kept: the units and
            the frequency, under each name rather than in columns of
            their own.
          */}
          {brochure.services.length ? (
            <div
              style={{
                marginTop: px(20 + d(20) - d(12)),
                /* Its own white, now that there is no card behind it:
                   the section sits on the grey band, and a table with
                   transparent rows would read as part of the band. */
                backgroundColor: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {/* The plan sheet's red block, naming the column the
                        rows belong to. It compares four plans; this is
                        written for one, so it names that one. */}
                    <th
                      style={{
                        width: "46%",
                        backgroundColor: C.plan,
                        color: C.white,
                        textAlign: "left",
                        verticalAlign: "middle",
                        padding: `${px(14 - d(15))} 14px ${px(14 + d(9))}`,
                      }}
                    >
                      <div style={{ fontSize: "15px", fontWeight: 700, lineHeight: "20px" }}>
                        Your plan
                      </div>
                      <div
                        style={{
                          fontSize: "9px",
                          lineHeight: "13px",
                          opacity: 0.9,
                          marginTop: px(2),
                        }}
                      >
                        AED {formatProposalFee(brochure.monthlyFee)} a month · AED{" "}
                        {formatProposalFee(brochure.annualFee)} a year excl. VAT
                      </div>
                    </th>
                    <th style={planHead}>UNITS</th>
                    <th style={planHead}>FREQUENCY</th>
                    <th style={planHead}>COVERED</th>
                  </tr>
                </thead>
                <tbody>
                  {brochure.services.map((service) => (
                    <tr key={service.label}>
                      <td style={{ ...planCell, textAlign: "left", fontWeight: 700 }}>
                        {service.label}
                      </td>
                      <td style={planCell}>{service.units}</td>
                      <td style={planCell}>{service.frequency}</td>
                      <td style={planCell}>
                        <img
                          src={iconTick.src}
                          alt="Covered"
                          style={{
                            height: "12px",
                            width: "12px",
                            objectFit: "contain",
                            display: "inline-block",
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                  {/*
                    What is true of the contract rather than of any one
                    service, in the merged rows the plan sheet puts at the
                    bottom for exactly this. They read as their own rows
                    without a band announcing them, because the left-hand
                    label already says which is which.
                  */}
                  <tr>
                    <td style={{ ...planCell, textAlign: "left", fontWeight: 700 }}>Coverage</td>
                    <td colSpan={3} style={planCell}>
                      {brochure.coverageMonths}{" "}
                      {brochure.coverageMonths === 1 ? "month" : "months"} from{" "}
                      {brochure.startLabel}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ ...planCell, textAlign: "left", fontWeight: 700 }}>Payment</td>
                    <td colSpan={3} style={{ ...planCell, borderBottom: "none" }}>
                      {brochure.paymentTerms}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: "12px", marginTop: "16px" }}>No services selected.</div>
          )}
          {copy.servicesNote ? (
            <div style={{ fontSize: "11px", lineHeight: "15px", fontStyle: "italic", marginTop: "16px" }}>{copy.servicesNote}</div>
          ) : null}
        </div>

        {/* 8. Build your own AMC: the copy left, the template's puzzle right */}
        {copy.buildTitle || copy.buildLead.length || copy.buildNote ? (
          <div style={{ display: "flex", alignItems: "center", gap: "24px", marginTop: "40px" }}>
            <div style={{ flex: "0 0 220px" }}>
              {copy.buildTitle ? (
                <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: "26px", color: C.red }}>{copy.buildTitle}</div>
              ) : null}
              {copy.buildLead.length ? (
                <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: "19px", marginTop: px(12 + d(20) - d(13)) }}>
                  {copy.buildLead.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              ) : null}
              {copy.buildNote ? (
                <div style={{ fontSize: "11px", fontStyle: "italic", lineHeight: "17px", marginTop: px(16 + d(13) - d(11)) }}>{copy.buildNote}</div>
              ) : null}
            </div>
            <img
              src={puzzle.src}
              alt="Build your own AMC: electrical, duct cleaning, plumbing, AC, painting, water tank, handyman and emergency modules"
              style={{ flex: "1 1 auto", minWidth: 0, width: "100%", height: "auto", objectFit: "contain", display: "block" }}
            />
          </div>
        ) : null}


        {/* 9. Trusted, the button, how to reach us, the address */}
        {/* 28px: with the space above the large type it reads as 48. */}
        <div style={{ textAlign: "center", padding: `${px(28 - d(25))} 0 ${px(24 + d(9))}` }}>
          {copy.trusted.length ? (
            <div style={{ fontSize: "25px", lineHeight: "32px" }}>
              {copy.trusted.map((run, index) => (
                <span
                  key={index}
                  style={{
                    whiteSpace: "pre-wrap",
                    ...(run.strong ? { fontWeight: 700, color: C.red } : { color: C.text }),
                  }}
                >
                  {run.text}
                </span>
              ))}
            </div>
          ) : null}
          {copy.cta ? (
            <div
              style={{
                width: "332px",
                height: "36px",
                margin: `${px(44 + d(25))} auto 0`,
                boxSizing: "border-box",
                borderRadius: "6px",
                backgroundColor: C.red,
                color: C.white,
                fontSize: "13px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                paddingBottom: pdf ? px(2 * (d(13) + 1)) : 0,
              }}
            >
              {copy.cta}
            </div>
          ) : null}
          {copy.contact.length ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "6px",
                marginTop: px(16 - d(10)),
                fontSize: "10px",
                lineHeight: "14px",
              }}
            >
              {copy.contact.map((item, index) => (
                <span key={index} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {index > 0 ? <span style={{ paddingRight: "2px" }}>·</span> : null}
                  {CONTACT_ICONS[index] ? (
                    <img
                      src={CONTACT_ICONS[index]}
                      alt=""
                      style={{ height: "9px", width: "auto", objectFit: "contain", display: "block", position: "relative", top: px(pdf ? d(10) + 2 : 0) }}
                    />
                  ) : null}
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          {copy.address ? (
            <div style={{ fontSize: "9px", lineHeight: "12px", marginTop: "40px" }}>{copy.address}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: "20px", fontWeight: 700 }}>{children}</span>
);
const Small = ({ children, pdf = false }: { children: ReactNode; pdf?: boolean }) => (
  <span style={{ fontSize: "10px", fontWeight: 700, verticalAlign: pdf ? `${-(dropFor(20) - dropFor(10))}px` : "baseline" }}>
    {children}
  </span>
);

/*
  A cell of the plan strip, all with one anatomy: a bold title, the value
  large (its unit smaller), a small caption. The client's own plan is the
  one outlined in the primary red.
*/
function PlanCard({
  title,
  value,
  caption,
  highlight = false,
  width,
  pdf = false,
}: {
  title: string;
  value: ReactNode;
  caption: string | null;
  highlight?: boolean;
  width?: number;
  pdf?: boolean;
}) {
  const d = (fontSize: number) => (pdf ? dropFor(fontSize) : 0);
  /*
    The client's plan, filled rather than outlined.

    A red keyline around a white card read as a box someone had drawn
    round a number, and at a glance it looked no different from Coverage
    and Payment beside it. The plan sheet fills its chosen column solid
    and captions it, so this does too: the one card that carries the
    price is the one the eye lands on, and the other two stay quiet.
  */
  const style: CSSProperties = {
    flex: width ? `0 0 ${width}px` : 1,
    position: "relative",
    textAlign: "center",
    padding: `${20 - d(12)}px 12px ${20 + d(9.5)}px`,
    backgroundColor: highlight ? C.plan : C.white,
    color: highlight ? C.white : C.text,
    borderRadius: "10px",
    /* The filled card is its own shape; only the quiet ones need an edge. */
    border: highlight ? "none" : `1px solid ${C.line}`,
  };
  return (
    <div style={style}>
      <div style={{ fontSize: "12px", fontWeight: 700, lineHeight: "15px" }}>{title}</div>
      <div
        style={{
          marginTop: `${Math.max(0, 8 - (d(20) - d(12)))}px`,
          lineHeight: "24px",
          color: highlight ? C.white : C.red,
        }}
      >
        {value}
      </div>
      {/* Kept even when empty, so every card has the same anatomy and height. */}
      <div
        style={{
          fontSize: "9.5px",
          lineHeight: "13px",
          marginTop: `${4 + d(20) - d(9.5)}px`,
          opacity: highlight ? 0.9 : 1,
        }}
      >
        {caption ?? " "}
      </div>
    </div>
  );
}
