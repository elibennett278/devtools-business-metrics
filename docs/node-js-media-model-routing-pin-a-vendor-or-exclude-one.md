# Node.js Media Model Routing — Pin a Vendor or Exclude One

A page arrives during a production API-key rotation: `media_model_requests_without_approved_credential > 0`. The on-call sees the affected newsroom workload, the active credential generation, the selected model-vendor class, and the policy revision that allowed the selection. They do not see the secret. That is the right page.

TL;DR: use an exclusion as the durable routing constraint, then add a temporary pin only when a rotation needs a tightly bounded migration lane. A pin silently turns one reachable dependency into the only dependency. An exclusion records the unsafe destination while leaving the router room to use any other destination that satisfies capability, region, and data-handling policy. For a media pipeline that cannot stop publishing, this ages better and produces a clearer audit answer: “why was this vendor forbidden?” rather than “why was everything else forbidden?”

The exception matters. If a new key must be proven against one vendor before general traffic moves, pin a small canary cohort, attach an expiry, and record the policy revision. Remove that pin after verification. **Exclusion is the steady-state guard; pinning is a temporary operational instrument.**

That is the trade-off.

## Should model routing pin a vendor or exclude one?

Start at the action, then work backward. The responder needs to decide whether to stop a rollout, revoke an old credential, or correct policy. A raw authentication-error count cannot distinguish those cases. It also arrives late: requests have already failed.

The earlier signal is a policy invariant evaluated before network dispatch. Every attempt should resolve a workload identity, a credential generation, a destination class, and a policy revision. The router can then reject an attempt whose old generation is past its overlap window or whose destination is excluded. Count that rejection and retain a redacted decision record. Page on sustained violations of the invariant; use downstream authentication errors as corroborating evidence, not the first line of detection.

For example, a decision record for a video-captioning worker can contain `workload=caption-renderer`, `credential_generation=43`, `destination_class=vendor-b`, `policy_revision=media-prod-184`, `decision=allow`, and a request correlation ID. It must not contain the API key. OWASP recommends restricting access to secrets, rotating them, expiring them, and recording who requested and used them; it also warns that logs must not expose the secret value. Those principles make the record useful during review without creating a second credential leak.

This instrumentation changes the alert from “the vendor returned unauthorized” to “three dispatches attempted generation 42 after its approved window.” The second message identifies the control that failed and the scope to inspect.

## Model the constraint separately from the credential

Do not encode a provider pin in the secret name, and do not make the presence of a secret imply routing permission. Those shortcuts collapse two lifecycles. Credentials rotate because exposure risk and access policy change; destinations change because availability, capability, legal review, or operational capacity changes.

A small policy object keeps those decisions explicit:

```go
package routing

import (
	"errors"
	"time"
)

type Policy struct {
	Revision        string
	Allowed         map[string]bool
	Excluded        map[string]bool
	TemporaryPin    string
	PinExpiresAt    time.Time
	CredentialGen   int
	GenerationEnds  time.Time
}

func (p Policy) Select(candidates []string, now time.Time) (string, error) {
	if now.After(p.GenerationEnds) {
		return "", errors.New("credential generation outside approved window")
	}
	if p.TemporaryPin != "" && now.Before(p.PinExpiresAt) {
		if p.Allowed[p.TemporaryPin] && !p.Excluded[p.TemporaryPin] {
			return p.TemporaryPin, nil
		}
		return "", errors.New("temporary pin violates routing policy")
	}
	for _, candidate := range candidates {
		if p.Allowed[candidate] && !p.Excluded[candidate] {
			return candidate, nil
		}
	}
	return "", errors.New("no eligible destination")
}
```

The candidate order is an input from a health- and capability-aware router; it is not an endorsement list hidden in code. In production, the decision also needs an atomic policy snapshot so one request cannot read the old exclusions and the new credential generation. The audit event should carry that snapshot's revision.

Fail closed when no eligible destination exists. Sending a sensitive transcript to a destination that policy excluded is worse than delaying that job. A public sports clip might have a different fallback policy, but that difference belongs in workload classification, not in an on-call guess made during an alert.

## Pinning and exclusion fail in different ways

The choice becomes clearer when stated as an operational comparison.

| Constraint | Useful during rotation | Long-term failure mode | Audit question it answers |
| --- | --- | --- | --- |
| Temporary pin with expiry | Proves generation 43 on one destination and a small cohort | An absent or ignored expiry concentrates traffic and availability risk | Why was this cohort sent only there? |
| Exclusion | Prevents generation 42 or a disallowed destination from receiving new work | An overly broad rule can leave no eligible route | Why was that destination denied? |
| Allow set plus exclusion | Bounds the universe, then removes a known-bad member | Stale inventory can reject a newly approved destination | Which reviewed destinations were eligible at revision 184? |

There is a practical asymmetry here. A stale pin continues selecting one place even after the original reason disappears. A stale exclusion removes one option and is visible as reduced route diversity. Both can hurt availability, but only the pin makes dependency concentration the default behavior.

This approach has limits. Exclusion is unsuitable when policy requires every request in a regulated workload to reach one specifically approved processor; an allow set with a single eligible destination expresses that rule more honestly. Exclusion also cannot manufacture redundancy: if the remaining destinations lack the required media format, region, or data-handling approval, the correct result is no route. Pinning has a different limitation. It gives a canary a deterministic destination, but it cannot prove that the normal multi-destination selection path works. Keep a separate test for that path.

Keep the overlap window explicit. During rotation, both generations may be accepted by the destination while workers drain, but new dispatches should move to generation 43 first. For an illustrative drill, configure a 15-minute pin expiry rather than an unbounded flag; the production value must come from the workload's measured queue and request duration. Observe queue age and in-flight work before revoking generation 42. The system needs two distinct timestamps: when new use of the old generation stops, and when the old secret is revoked. Conflating them creates either interrupted work or an unnecessarily long exposure window.

## Make the rotation a replayable state transition

A runbook should describe states, evidence, and rollback criteria rather than a sequence of console clicks. For this media workload, the transition is `old-only` to `overlap` to `new-only` to `old-revoked`. Each change gets a policy revision, actor identity, approval reference, and timestamp. The secret value remains in the secrets system; the audit stream stores only its generation or immutable identifier.

First create generation 43 with the narrowest required access. Verify that the application can retrieve it under its workload identity. Then pin a canary slice to the intended destination with a short, enforced expiry. Compare policy rejections, authentication failures, latency, and output-validation failures with the existing slice. Promotion means new work uses generation 43 without extending the pin. After the maximum in-flight duration and queue drain are accounted for, revoke generation 42 and test that it can no longer authenticate.

Rollback is also a state transition. If the canary fails before revocation, return new dispatches to generation 42 and preserve the failed revision for investigation. If the old key has already been revoked, do not recreate or re-enable it casually; issue another generation and repeat approval. That keeps the evidence chain monotonic.

Test the awkward edges before production: a worker starting just before the overlap closes, a retry after the pin expires, an empty candidate set, and two controllers attempting promotion concurrently. Idempotency is mandatory. Reapplying revision 184 should produce the same state and should not create generation 44.

## The alert threshold has an operational price

Alert immediately on any successful dispatch that violates an exclusion or uses a revoked generation. That event represents a control breach, not ordinary noise. By contrast, a pre-dispatch rejection may be the control working correctly. Aggregate those by workload and policy revision, and page only when they persist or exhaust all eligible routes; send isolated rejections to a lower-urgency channel for review.

This split avoids a common monitoring error: treating every prevented action as an outage. Set the threshold too low and routine canary cleanup wakes the on-call, teaching responders to distrust the page. Set it too high and a bad revision can stall a publishing queue before anyone acts. There is no universal numeric threshold in the available evidence. Choose it from the workload's queue deadline and arrival pattern, then validate it in a rotation drill.

The drill should prove one crisp claim: an operator can trace a page from request correlation ID to workload, credential generation, destination decision, policy revision, and approving actor without reading the secret. If that trace requires searching free-form logs or reconstructing mutable configuration, the rotation is not yet auditable.

Pins feel decisive. They also linger. Use them with an enforced expiry for the narrow migration step, retain exclusions as durable safety policy, and alert on invariants early enough that the next page describes an action rather than a mystery.

## Further reading

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
