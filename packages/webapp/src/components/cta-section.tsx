import Link from "next/link";

export function CtaSection() {
  return (
    <section className="relative overflow-hidden border-t border-border">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] via-transparent to-transparent" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-t from-primary/[0.05] to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-3xl px-4 py-24 text-center">
        <h2 className="text-4xl font-bold mb-4 tracking-tight">Start inside your stack.</h2>
        <p className="text-lg text-muted-foreground mb-10 max-w-lg mx-auto">
          Install the SDK, bring your provider keys, and keep the execution path under your control.
        </p>

        <div className="animate-fade-in-up flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/docs"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] active:scale-[0.98]"
          >
            Read the docs
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

        <pre className="animate-fade-in-up animate-delay-200 mt-10 inline-flex items-center gap-2 rounded-xl bg-muted px-6 py-3 text-sm font-mono">
          <span className="text-green-500">$</span>
          bun add @weysabi/sabi
        </pre>
      </div>
    </section>
  );
}
