import type { Metadata } from "next";
import { Archivo_Black, Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * Archivo Black for display, Space Grotesk for everything else.
 *
 * Deliberately not Inter/Roboto/system-ui — those are the default-looking faces the
 * human specifically didn't want. plan.md §11.2 already reserves an "ARCHIVO" treatment
 * for engraved labels, so the display face was sanctioned even under the old design.
 *
 * next/font self-hosts and preloads these, so there's no runtime request to Google and
 * no layout shift — the §11.7 performance floor (LCP < 2.5s, CLS < 0.05) survives the
 * switch away from a system stack.
 */
const display = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
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
    <html lang="en" className={`${display.variable} ${body.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
