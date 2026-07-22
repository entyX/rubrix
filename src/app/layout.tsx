import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

/**
 * Bricolage Grotesque (display) + Instrument Sans (body/UI) + DM Mono (every score,
 * timestamp, criterion code, label) — the "Score Sheet" type system (DECISIONS D-017).
 *
 * next/font self-hosts and preloads these, so there's no runtime request to Google and
 * no layout shift — the performance floor (LCP < 2.5s, CLS < 0.05) survives the switch,
 * same rationale D-011 used for the previous type system.
 */
const display = Bricolage_Grotesque({
  weight: ["600", "800"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Instrument_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rubrix — Know your score before the judges do",
  description:
    "Record a practice run of your CTSO event and get it scored line by line against the official rubric, with the exact words that earned each mark.",
};

/**
 * D-031: the deployed build stamped in a corner of every page. Server-rendered into the
 * HTML (not a JS chunk), so it reflects exactly what production is serving and can't be
 * hidden by the stale-chunk caching that made "is it deployed?" impossible to answer.
 * NEXT_PUBLIC_BUILD_SHA is inlined at build time from Vercel's commit sha (next.config).
 */
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'local';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <span
          aria-hidden
          title={`Rubrix build ${BUILD_SHA}`}
          style={{
            position: 'fixed',
            bottom: 6,
            right: 8,
            zIndex: 50,
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
            fontSize: 10,
            lineHeight: 1,
            letterSpacing: '0.03em',
            color: 'rgba(60,60,60,0.4)',
            pointerEvents: 'none',
          }}
        >
          v·{BUILD_SHA}
        </span>
      </body>
    </html>
  );
}
