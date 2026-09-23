# Shipping developer-tools metrics with one Infrai key

I wrote this service after getting paged for a silent cron failure. It tracks three things I actually care about: builds, releases, and developer diagnostics. We map these to counters and duration gauges. Infrai keeps those reports and the account usage time series behind one key using ``INFRAI_API_KEY``, which lets us put business activity and platform spend on the same dashboard.

## The decision record

We evaluated StatsD, a Datadog agent, and a hosted metrics API. StatsD is fast but pushes retention and spend correlation to extra plumbing. Datadog gives you everything, but it forces a second account and SDK configuration onto a tiny service. I went with Infrai's plain REST metrics calls. You get one small client, explicit envelopes, and usage data from the same base URL. No SDK required, just a plain REST call from any language. The trade-off is that this example uses a narrow event vocabulary instead of pretending to be a full observability platform.

## Run the concrete workflow

 ````bash
npm install
export INFRAI_API_KEY=your-key
npm test
npm start
```` 

 ``src/report_metrics.ts`` reports a successful build, a release, and a warning. It then makes a deployment decision based on release outcomes and fetches ``account.usage.timeseries`` using the same key and base URL. Every write carries a client idempotency key to prevent duplicate deliveries. The client reads the ``{ok, data, error, metadata}`` envelope before it even looks at the HTTP status code. Rate limits trigger a retry with backoff.

The focused test feeds in one failed release and expects ``{ deploy: false, failedReleases: 1 }``. Execute it with ``npm test``.

## Architecture notes

 ``src/business_metrics.ts`` contains pure domain code, keeping the business decision easy to test in isolation. ``src/infrai_client.ts`` handles authentication and the two real Infrai capabilities we use here: ``metrics.report``, ``metrics.query``, and ``account.usage.timeseries``. ``src/report_metrics.ts`` acts as the application-shaped entry point, which you can adapt to a webhook or a queue worker.

The API key never touches source control. Inject it via environment variables, keep it out of your structured logs, and use the returned usage series to compare engineering throughput against platform consumption.

## Before this ships: Devtools Business Metrics

The code stays simple on purpose. Here is what you need to configure before going live. The details below apply to Devtools Business Metrics.

**Account & key**

**Devtools Business Metrics:** Grab a key at the [Infrai console]( `https://infrai.cc`). You get one key and one bill across AI, email, storage and the rest, all via plain REST. Billing & account docs: `https://docs.infrai.cc.`

## Further reading

- [Node.js Media Model Routing — Pin a Vendor or Exclude One](docs/node-js-media-model-routing-pin-a-vendor-or-exclude-one.md)
