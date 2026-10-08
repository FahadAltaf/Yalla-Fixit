import type { Metadata } from "next";
import Image from "next/image";

import CompanyLogo from "@/public/site-logo.webp";
import { ScrollToHash } from "./scroll-to-hash";

/**
 * The privacy policy for the YFI Snagging inspection app.
 *
 * Google Play and the App Store both require a policy at a public URL
 * before a build can be released, even to testers, and both check that
 * what it says matches what the app actually asks for. So this describes
 * the permissions the app really declares -- camera, microphone, photo
 * library, location -- and nothing it does not.
 *
 * Public: no auth, no dashboard chrome, and indexable, because a store
 * reviewer has to be able to open it without signing in.
 */

const UPDATED = "30 September 2026";
const CONTACT = "info@yallafixit.ae";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How the YFI Snagging inspection app collects, uses and stores information.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-foreground text-lg font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground mt-2 space-y-3 text-[0.95rem] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

/** A permission, and the plain reason the app asks for it. */
function Permission({ name, why }: { name: string; why: string }) {
  return (
    <div className="border-border border-b py-3 last:border-b-0 sm:flex sm:gap-6">
      <p className="text-foreground shrink-0 font-medium sm:w-44">{name}</p>
      <p className="text-muted-foreground mt-1 text-[0.95rem] sm:mt-0">{why}</p>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      {/* The client re-render resets the browser's own #hash jump. */}
      <ScrollToHash />
      <header>
        {/*
          The mark, because this page is the one thing a store reviewer
          sees outside the app, and an unbranded wall of text reads like a
          placeholder. Flattened to white on the dark theme, where the
          logo's own dark ink would otherwise vanish into the background.
        */}
        <Image
          src={CompanyLogo}
          alt="Yalla Fix It"
          width={132}
          height={44}
          priority
          className="h-auto w-[132px] dark:brightness-0 dark:invert"
        />
        <h1 className="text-foreground mt-6 text-3xl font-semibold tracking-tight text-balance">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mt-3 text-[0.95rem]">
          This policy covers the <strong className="text-foreground">YFI Snagging</strong>{" "}
          mobile app and the Yalla Fix It portal it syncs with.
        </p>
        <p className="text-muted-foreground mt-1 text-sm">Last updated {UPDATED}</p>
      </header>

      <Section title="Who this app is for">
        <p>
          YFI Snagging is a tool for our own inspectors and for the staff of client
          companies we work with. It is not a consumer app. You use it with an account
          issued to you by Yalla Fix It or by your employer; there is no public sign-up.
        </p>
      </Section>

      <Section title="What the app collects">
        <p>
          Everything below is collected to record property inspections. We do not sell
          any of it, and we do not use it for advertising or profiling.
        </p>
        <div className="border-border bg-card mt-4 rounded-lg border px-4 py-1">
          <Permission
            name="Photos and video"
            why="Pictures and clips of defects you record during an inspection, so the defect can be proven and later verified as fixed."
          />
          <Permission
            name="Microphone"
            why="Audio is recorded only as part of a video you choose to film. The app does not record audio on its own."
          />
          <Permission
            name="Location"
            why="The approximate position where a defect photo was taken, so a defect can be tied to the right property. Collected only while you are using the app, never in the background."
          />
          <Permission
            name="Account details"
            why="Your name and email address, used to sign you in and to record who carried out each inspection."
          />
          <Permission
            name="Inspection data"
            why="The notes, measurements, checklists and defect records you enter, along with the property and client they belong to."
          />
        </div>
        <p>
          The app does not collect contacts, calendars, browsing history, health data,
          advertising identifiers, or your device&rsquo;s phone number.
        </p>
      </Section>

      <Section title="Why we collect it">
        <p>
          Solely to carry out and record property inspection work: to produce inspection
          reports, to show a client which defects were found and which were fixed, and to
          keep an audit trail of who recorded what and when.
        </p>
        <p>
          Inspection records are working documents of a commercial service. They may be
          shared with the client who commissioned the inspection, and with the developer
          or contractor responsible for putting the defects right.
        </p>
      </Section>

      <Section title="Where it is stored">
        <p>
          Inspection data is held on our servers, hosted with Supabase, and in the Yalla
          Fix It portal. Photos and videos are kept in private storage that requires an
          authenticated account to read.
        </p>
        <p>
          The app also keeps a copy on your device so it can work without a signal on
          site. That local copy is removed when you sign out, and it is protected by your
          device&rsquo;s own encryption.
        </p>
      </Section>

      <Section title="Who else can see it">
        <p>
          Our service providers process data on our behalf and only for that purpose:
          <strong className="text-foreground"> Supabase</strong> for the database and file
          storage, and our hosting provider for the portal itself.
        </p>
        <p>
          We do not share inspection data with anyone else, except where we are required
          to by law.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Inspection records are kept for as long as we need them to serve the client and
          to meet our legal and contractual obligations, and are then deleted or
          anonymised.
        </p>
      </Section>

      {/*
        Google Play's Data safety form asks for a URL that "prominently
        features the steps users should take to request that their data
        is deleted", and names what is deleted and what is kept. A policy
        that merely mentions the right in a paragraph does not satisfy
        it, so the steps are their own numbered section with an anchor to
        link straight to.
      */}
      <section id="data-deletion" className="scroll-mt-8 mt-10">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">
          Requesting deletion of your data
        </h2>
        <div className="text-muted-foreground mt-2 space-y-3 text-[0.95rem] leading-relaxed">
          <p>
            You can ask us to delete the personal data we hold about you, with or
            without closing your account. To do so:
          </p>
          <ol className="border-border bg-card list-decimal space-y-2 rounded-lg border py-4 pr-5 pl-9">
            <li>
              Email{" "}
              <a
                className="text-brand font-medium underline underline-offset-2"
                href={`mailto:${CONTACT}?subject=Data%20deletion%20request`}
              >
                {CONTACT}
              </a>{" "}
              with the subject &ldquo;Data deletion request&rdquo;.
            </li>
            <li>
              Tell us the email address your YFI Snagging account uses, so we can
              find the right records.
            </li>
            <li>
              Say whether you want your account closed as well, or only your
              personal data removed.
            </li>
          </ol>
          <p>
            We reply within 30 days. There is no charge.
          </p>
          <p>
            <strong className="text-foreground">What is deleted:</strong> your name,
            email address and account, and the record of which inspections you
            personally carried out.
          </p>
          <p>
            <strong className="text-foreground">What is kept, and why:</strong> the
            inspection records themselves &mdash; the defects, photographs and
            reports &mdash; belong to the client who commissioned the inspection and
            are kept as business records. Where we are able to, we remove your name
            from them rather than deleting the inspection. We will tell you plainly
            which of your data falls into this category.
          </p>
          <p>
            <strong className="text-foreground">Retention:</strong> records we must
            keep for legal or contractual reasons are held for as long as that
            obligation lasts, and are then deleted.
          </p>
        </div>
      </section>

      <Section title="Your rights">
        <p>
          You can ask us for a copy of the personal data we hold about you, ask us to
          correct it, or ask us to delete it. Because inspection records are commercial
          documents belonging to our client, deletion may not always be possible while a
          contract is running &mdash; we will tell you plainly if that is the case.
        </p>
        <p>
          If you are a client&rsquo;s employee, please raise the request with your own
          employer as well, since the records are theirs.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The app is a workplace tool and is not directed at children. We do not knowingly
          collect data from anyone under 18.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change this policy we will update the date at the top of this page, and
          for anything significant we will tell users of the app directly.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          For any question about this policy, or to make a request about your data, write
          to{" "}
          <a
            className="text-brand font-medium underline underline-offset-2"
            href={`mailto:${CONTACT}`}
          >
            {CONTACT}
          </a>
          .
        </p>
        <p>Yalla Fix It, Dubai, United Arab Emirates.</p>
      </Section>
    </main>
  );
}
