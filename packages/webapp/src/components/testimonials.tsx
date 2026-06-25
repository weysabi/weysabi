const testimonials = [
  {
    quote:
      "We replaced 3 separate AI SDK wrappers with one import. Failover alone saved us from 2 outages last quarter.",
    author: "Sarah Chen",
    role: "Engineering Lead, DataForge",
    initials: "SC",
    color: "bg-violet-500/10 text-violet-600",
  },
  {
    quote:
      "The RAG engine is dead simple — point it at your docs and it just works. No vector DB setup needed.",
    author: "Marcus Rivera",
    role: "CTO, DocuMind",
    initials: "MR",
    color: "bg-emerald-500/10 text-emerald-600",
  },
  {
    quote:
      "Structured output with Zod schemas means we never parse LLM responses by hand anymore. Type-safe from edge to edge.",
    author: "Aiko Tanaka",
    role: "Founder, PromptLab",
    initials: "AT",
    color: "bg-amber-500/10 text-amber-600",
  },
];

export function TestimonialsSection() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-24">
      <h2 className="text-3xl font-bold text-center mb-12">Used by teams that ship</h2>
      <div className="grid gap-8 sm:grid-cols-3">
        {testimonials.map((t, i) => (
          <div
            key={t.author}
            className="animate-fade-in-up group rounded-xl border border-border bg-card p-6 transition-all hover:shadow-md hover:border-primary/20"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            <svg
              className="h-6 w-6 text-muted-foreground/30 mb-4"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zM0 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151C7.546 6.068 5.983 8.789 5.983 11H10v10H0z" />
            </svg>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              &ldquo;{t.quote}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${t.color}`}
              >
                {t.initials}
              </div>
              <div>
                <p className="text-sm font-semibold">{t.author}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
