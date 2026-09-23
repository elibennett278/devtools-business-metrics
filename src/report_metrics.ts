import { account, metrics } from "./infrai_client.js";
import { metricReports, releaseDecision, type BuildEvent, type DiagnosticEvent, type ReleaseEvent } from "./business_metrics.js";

const events: (BuildEvent | ReleaseEvent | DiagnosticEvent)[] = [
  { service: "checkout", outcome: "succeeded", durationMs: 840 },
  { service: "checkout", commit: "a1b2c3d", outcome: "succeeded", durationMs: 1200 },
  { service: "checkout", severity: "warning" },
];
for (const event of events) for (const report of metricReports(event)) await metrics.report({ ...report, idempotency_key: `${report.name}-${report.value}-${JSON.stringify(report.tags)}` });
const decision = releaseDecision(events.filter((e): e is ReleaseEvent => "commit" in e));
const usage = await account.usageTimeseries({});
console.log(JSON.stringify({ decision, usage }, null, 2));
