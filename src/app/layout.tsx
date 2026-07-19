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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
