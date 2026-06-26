import { Sparkles, Shield, Brain, Zap, Workflow, BookOpen } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Provider failover",
    description:
      "Auto-fallback between Groq, OpenAI, Anthropic, Google, and more. Circuit breaker, retry with backoff, and per-provider timeouts.",
    gradient: "from-amber-500/20 via-amber-500/5 to-transparent",
    iconBg: "bg-amber-500/10 text-amber-600",
  },
  {
    icon: Brain,
    title: "RAG engine",
    description:
      "Built-in vector search with HNSW indexes. Ingest files, directories, or raw text. Query across projects with cross-project search.",
    gradient: "from-blue-500/20 via-blue-500/5 to-transparent",
    iconBg: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: Shield,
    title: "Guardrails",
    description:
      "PII redaction, prompt injection detection, content safety, output token limits, and custom validators. Plugin architecture.",
    gradient: "from-emerald-500/20 via-emerald-500/5 to-transparent",
    iconBg: "bg-emerald-500/10 text-emerald-600",
  },
  {
    icon: Sparkles,
    title: "Structured output",
    description:
      "Zod schemas for type-safe LLM responses. Streaming SSE, Express, Fastify, Hono, Next.js, and Elysia adapters included.",
    gradient: "from-violet-500/20 via-violet-500/5 to-transparent",
    iconBg: "bg-violet-500/10 text-violet-600",
  },
  {
    icon: Workflow,
    title: "Prompt management",
    description:
      "Typed, versioned templates with {variable} substitution. Run prompts through the full provider pipeline in one call.",
    gradient: "from-rose-500/20 via-rose-500/5 to-transparent",
    iconBg: "bg-rose-500/10 text-rose-600",
  },
  {
    icon: BookOpen,
    title: "Server & CLI",
    description:
      "Drop-in OpenAI-compatible HTTP server. CLI for `sabi init`, `sabi server`, and interactive provider setup.",
    gradient: "from-cyan-500/20 via-cyan-500/5 to-transparent",
    iconBg: "bg-cyan-500/10 text-cyan-600",
  },
];

export function FeaturesSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <h2 className="text-3xl font-bold text-center mb-4">
        A production path from request to response
      </h2>
      <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
        Compose only the capabilities your application needs. The core execution path remains small,
        typed, and provider-neutral.
      </p>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <div
            key={feature.title}
            className="animate-fade-in-up group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:shadow-lg hover:border-primary/20"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div
              className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity`}
            />
            <div className="relative">
              <div
                className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${feature.iconBg}`}
              >
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
