import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Queueline: free waitlists with referrals", template: "%s · Queueline" },
  description: "Hosted waitlists with email capture, positions and a referral link that moves people up the line. Free, no account needed.",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#fbfbfa" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
