import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import "../styles/tokens.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ErrorReporter } from "@/components/ErrorReporter";
import { ChainGuard } from "@/components/ChainGuard";
import { WinWatcher } from "@/components/WinWatcher";
import { ThemeScript } from "@/components/ThemeScript";
import { BodyLines } from "@/components/redesign/BodyLines";
import { SideRail } from "@/components/redesign/SideRail";
import { FeedbackPin } from "@/components/redesign/FeedbackPin";
import {
  PRODUCT_DESCRIPTION,
  IS_AGON_DEPLOYMENT,
  PRODUCT_NAME,
  PRODUCT_SITE_URL,
  PRODUCT_TITLE,
} from "@/lib/product";

// Canonical site origin. Drives metadataBase so the opengraph-image /
// twitter-image routes resolve to absolute URLs in the unfurl tags. Override
// with NEXT_PUBLIC_SITE_URL for preview deploys.
export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT_SITE_URL),
  // Per-page titles read as "Contest #117 · Agon"; the home title stays whole.
  title: { default: PRODUCT_TITLE, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  keywords: [PRODUCT_NAME, "Arc Testnet", "Circle", "USDC", "AI agents", "ERC-8004", "agent services", "adversarial testing", "agent syndicates"],
  // opengraph-image.tsx and twitter-image.tsx auto-populate the card images, so
  // they are intentionally not listed here.
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    url: PRODUCT_SITE_URL,
    title: PRODUCT_TITLE,
    description: PRODUCT_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_TITLE,
    description: PRODUCT_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable}`}>
      <head>
        <ThemeScript forceDark={IS_AGON_DEPLOYMENT} />
      </head>
      <body>
        {IS_AGON_DEPLOYMENT ? null : <BodyLines />}
        <Providers>
          <ChainGuard />
          {children}
          {IS_AGON_DEPLOYMENT ? null : <SideRail />}
          {IS_AGON_DEPLOYMENT ? null : <WinWatcher />}
          {IS_AGON_DEPLOYMENT ? null : <FeedbackPin />}
        </Providers>
        <ErrorReporter />
      </body>
    </html>
  );
}
