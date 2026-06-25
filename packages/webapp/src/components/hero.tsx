import Link from "next/link";
import { Logo } from "./logo";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pt-16 pb-24 sm:pt-24 sm:pb-32 text-center">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] via-transparent to-transparent" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-primary/[0.07] to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-4xl">
        <div className="animate-fade-in mb-4">
          <Logo className="h-8 mx-auto text-primary" />
        </div>

        <h1 className="animate-fade-in animate-delay-100 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
          AI orchestration
          <br />
          <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
            for fullstack devs
          </span>
        </h1>

        <p className="animate-fade-in animate-delay-200 mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          One library, zero markup. Provider failover, structured output, RAG, guardrails, and
          prompts — all in a single Bun-native package.
        </p>

        <div className="animate-fade-in-up animate-delay-300 mt-10 flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/docs"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98]"
          >
            Get started
          </Link>
          <Link
            href="https://github.com/weysabi/sabi"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-8 text-sm font-medium transition-all hover:bg-muted hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </Link>
        </div>

        <div className="animate-fade-in animate-delay-500 mt-16 flex items-center justify-center gap-8 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Bun native
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            TypeScript
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            MIT license
          </span>
        </div>
      </div>
    </section>
  );
}
