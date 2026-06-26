import Link from "next/link";
import { Logo } from "@/components/logo";
import { HeroSection } from "@/components/hero";
import { StatsStrip } from "@/components/stats-strip";
import { FeaturesSection } from "@/components/features";
import { CodeDemoSection } from "@/components/code-demo";
import { CtaSection } from "@/components/cta-section";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7" />
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Admin
            </Link>
            <Link
              href="https://github.com/weysabi/sabi"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <HeroSection />
        <StatsStrip />
        <FeaturesSection />
        <CodeDemoSection />
        <CtaSection />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-10 flex items-center justify-between">
          <Logo className="h-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">MIT License &middot; Weysabi</p>
        </div>
      </footer>
    </div>
  );
}
