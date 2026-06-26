import Link from "next/link";
import { ArrowRight, Check, Copy } from "lucide-react";

const capabilities = ["Provider failover", "Structured output", "Local-first data"];

export function HeroSection() {
  return (
    <section className="hero-grid relative overflow-hidden border-b border-border">
      <div className="hero-glow absolute inset-x-0 top-0 h-[36rem] pointer-events-none" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-28">
        <div>
          <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background/75 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Open source · v0.9
          </div>

          <h1 className="animate-fade-in animate-delay-100 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Production AI infrastructure,
            <span className="block text-muted-foreground">inside your stack.</span>
          </h1>

          <p className="animate-fade-in animate-delay-200 mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            Run models across providers with retries, failover, typed prompts, guardrails,
            streaming, and local RAG—without routing application traffic through another vendor.
          </p>

          <div className="animate-fade-in-up animate-delay-300 mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/getting-started"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              Start building
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="https://github.com/weysabi/sabi"
              className="inline-flex h-11 items-center rounded-lg border border-border bg-background/70 px-5 text-sm font-medium shadow-sm backdrop-blur transition hover:bg-muted"
            >
              View on GitHub
            </Link>
          </div>

          <div className="animate-fade-in animate-delay-500 mt-9 flex flex-wrap gap-x-6 gap-y-3">
            {capabilities.map((capability) => (
              <span
                key={capability}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {capability}
              </span>
            ))}
          </div>
        </div>

        <div className="animate-fade-in-up animate-delay-200 relative">
          <div className="absolute -inset-8 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/10 backdrop-blur">
            <div className="flex h-11 items-center justify-between border-b border-border bg-muted/40 px-4">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">app.ts</span>
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <pre className="overflow-x-auto p-5 text-[13px] leading-6 sm:p-6">
              <code>{`import { createWeysabi } from "@weysabi/sabi";

const sabi = createWeysabi({
  groq: { apiKey: process.env.GROQ_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },
});

const result = await sabi.complete({
  model: "groq/llama-4-scout",
  fallbacks: ["openai/gpt-4o-mini"],
  messages: [
    { role: "user", content: "Summarize this incident." },
  ],
});

console.log(result.content);`}</code>
            </pre>
            <div className="grid grid-cols-3 border-t border-border bg-muted/25 text-center">
              {[
                ["Primary", "Groq"],
                ["Fallback", "OpenAI"],
                ["Traffic", "Your infra"],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-border px-2 py-3 last:border-r-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-1 text-xs font-medium">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
