import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { MainnetAlert } from "@/components/NetworkGuard";
import { Providers } from "@/components/Providers";
import { TestnetBanner } from "@/components/TestnetBanner";
import { TxDock } from "@/components/TxStatus";

import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Forma · Programmable staking positions (testnet)", template: "%s · Forma testnet" },
  description:
    "Forma turns a stake into an on-chain position: NFT-represented, lock-boosted, programmable rewards, liquid staking. Base Sepolia testnet only.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f3efe4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-lime focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <Providers>
          <TestnetBanner />
          <MainnetAlert />
          <Header />
          <main id="main" className="mx-auto max-w-[1440px] px-4 sm:px-8">
            {children}
          </main>
          <Footer />
          <TxDock />
        </Providers>
      </body>
    </html>
  );
}
