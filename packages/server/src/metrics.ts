export interface MetricsOptions {
  enabled?: boolean;
}

interface Counter {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
  type: "counter" | "gauge" | "histogram";
  buckets?: Record<string, number>;
}

export class MetricsStore {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Counter>();
  private gauges = new Map<string, Counter>();

  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  incCounter(name: string, labels: Record<string, string>, help?: string) {
    const key = `${name}{${this.labelKey(labels)}}`;
    const existing = this.counters.get(key);
    if (existing) {
      existing.value++;
    } else {
      this.counters.set(key, {
        name,
        help: help ?? name,
        labels,
        value: 1,
        type: "counter",
      });
    }
  }

  setGauge(name: string, value: number, labels: Record<string, string>, help?: string) {
    const key = `${name}{${this.labelKey(labels)}}`;
    this.gauges.set(key, {
      name,
      help: help ?? name,
      labels,
      value,
      type: "gauge",
    });
  }

  private readonly histogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  observeHistogram(name: string, value: number, labels: Record<string, string>, help?: string) {
    for (const le of this.histogramBuckets) {
      if (value > le) continue;
      const ls = { ...labels, le: String(le) };
      const key = `${name}_bucket{${this.labelKey(ls)}}`;
      const existing = this.histograms.get(key);
      if (existing) {
        existing.value++;
      } else {
        this.histograms.set(key, {
          name: `${name}_bucket`,
          help: help ?? name,
          labels: ls,
          value: 1,
          type: "histogram",
        });
      }
    }
    const infKey = `${name}_bucket{${this.labelKey({ ...labels, le: "+Inf" })}}`;
    const inf = this.histograms.get(infKey);
    if (inf) {
      inf.value++;
    } else {
      this.histograms.set(infKey, {
        name: `${name}_bucket`,
        help: help ?? name,
        labels: { ...labels, le: "+Inf" },
        value: 1,
        type: "histogram",
      });
    }
  }

  private formatMetric(m: Counter): string {
    const labels = Object.entries(m.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return [
      `# HELP ${m.name} ${m.help}`,
      `# TYPE ${m.name} ${m.type}`,
      `${m.name}{${labels}} ${m.value}`,
    ].join("\n");
  }

  textOutput(): string {
    const lines: string[] = [];
    lines.push("# weysabi server metrics");
    for (const m of this.counters.values()) lines.push(this.formatMetric(m));
    for (const m of this.histograms.values()) lines.push(this.formatMetric(m));
    for (const m of this.gauges.values()) lines.push(this.formatMetric(m));
    return lines.join("\n") + "\n";
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
