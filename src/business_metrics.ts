export type ReleaseEvent = { service: string; commit: string; outcome: "succeeded" | "failed"; durationMs: number };
export type BuildEvent = { service: string; outcome: "succeeded" | "failed"; durationMs: number };
export type DiagnosticEvent = { service: string; severity: "info" | "warning" | "error" };
type MetricReport = { name: string; type: "counter" | "gauge"; value: number; tags: Record<string, string> };

export function metricReports(event: ReleaseEvent | BuildEvent | DiagnosticEvent) {
  const reports: MetricReport[] = [{ name: `${event.service}.events`, type: "counter", value: 1, tags: { outcome: "outcome" in event ? event.outcome : event.severity, kind: "durationMs" in event ? ("commit" in event ? "release" : "build") : "diagnostic" } }];
  if ("durationMs" in event) reports.push({ name: `${event.service}.duration_ms`, type: "gauge" as const, value: event.durationMs, tags: { kind: "commit" in event ? "release" : "build" } });
  return reports;
}

export function releaseDecision(releases: ReleaseEvent[]) { const failed = releases.filter(r => r.outcome === "failed").length; return { deploy: failed === 0, failedReleases: failed }; }
