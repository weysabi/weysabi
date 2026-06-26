import { Box, Shield, Workflow, FileCode } from "lucide-react";

const stats = [
  { icon: Box, label: "Providers", value: "10+" },
  { icon: Shield, label: "Guardrails", value: "8+" },
  { icon: Workflow, label: "Adapters", value: "6" },
  { icon: FileCode, label: "License", value: "MIT" },
];

export function StatsStrip() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className="animate-fade-in-up text-center"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary">
                <stat.icon className="h-5 w-5" />
              </div>
              <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
