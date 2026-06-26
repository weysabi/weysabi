import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "fumadocs-ui/style.css";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata = {
  title: {
    template: "%s | Weysabi",
    default: "Weysabi — production AI infrastructure for TypeScript",
  },
  description:
    "Local-first TypeScript infrastructure for running production AI applications across providers.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body style={{ fontFamily: "var(--font-inter)" }}>
        <RootProvider
          search={{
            options: {
              type: "static",
              api: "/api/search",
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
