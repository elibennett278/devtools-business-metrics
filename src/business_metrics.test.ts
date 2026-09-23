import assert from "node:assert/strict";
import { metricReports, releaseDecision } from "./business_metrics.js";
const reports = metricReports({ service: "api", outcome: "failed", durationMs: 250 });
assert.equal(reports[0].type, "counter");
assert.equal(reports[1].type, "gauge");
assert.deepEqual(releaseDecision([{ service: "api", commit: "x", outcome: "failed", durationMs: 1 }]), { deploy: false, failedReleases: 1 });
console.log("business decision test passed");
