import { Database, Network, Server } from "lucide-react";

const layers = [
  {
    icon: Network,
    label: "Execution",
    title: "One provider-neutral pipeline",
    description:
      "Retries, circuit breaking, failover, structured output, guardrails, and telemetry apply consistently across providers.",
  },
  {
    icon: Database,
    label: "Data",
    title: "Local-first by default",
    description:
      "Credentials, conversations, vector indexes, and application data stay in infrastructure you operate and control.",
  },
  {
    icon: Server,
    label: "Delivery",
    title: "Embedded SDK or HTTP server",
    description:
      "Call Weysabi inside your TypeScript app or expose the same execution layer through an OpenAI-compatible server.",
  },
];

export function CodeDemoSection() {
  return (
    <section className="border-y border-border bg-muted/25">
      <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
              Architecture
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Infrastructure, not another gateway.
            </h2>
            <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
              Weysabi fits into the system you already own. It standardizes AI execution while
              leaving identity, authorization, persistence, and deployment boundaries with your
              application.
            </p>
          </div>

          <div className="grid gap-4">
            {layers.map((layer, index) => (
              <div
                key={layer.title}
                className="group grid gap-4 rounded-xl border border-border bg-card p-5 transition hover:border-blue-500/30 hover:shadow-md sm:grid-cols-[3rem_1fr]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                  <layer.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      0{index + 1}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-wider text-blue-600">
                      {layer.label}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold">{layer.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {layer.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
