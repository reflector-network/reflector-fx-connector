# @reflector/reflector-fx-connector

Foreign-exchange rates for the Reflector oracle, quoted against USD. Sources: ECB and NBP (no key; one fixing per business day, cached hourly), exchangerate-api (key; cached every five minutes), apilayer, abstractapi and forexrateapi (key; fetched live).

## Freshness

Cached fixings carry their upstream date (ECB `TIME_PERIOD`, NBP table A `effectiveDate`, exchangerate `time_last_update_unix`). A request for a tick more than the provider's maximum age after the fixing gets no data instead of a stale rate: 5 days for ECB and NBP (fixings are aged from midnight UTC of their publication day, so a Friday fixing still serves a Tuesday after a Monday holiday), 26 hours for exchangerate. NBP table B currencies are published weekly and can therefore be up to a week older than the table A anchor.

## Requests

`PriceProviderBase.makeRequest` applies a 10 s total deadline (a provider's own timeout is capped), a 5 MiB body cap, no redirects and 2xx-only; failures throw `RequestError` (`host`, `status`, `code`, `retryable`) and logs never include URLs, query strings or headers. A provider cannot loosen these limits: per-request `maxRedirects`, `maxContentLength`, `maxBodyLength` and `validateStatus` are overridden. A failure after a 2xx status (a connection dropped mid-body) is retryable; TLS certificate failures are not. Worst case per provider is three attempts × the 10 s cap plus 600 ms of back-off, about 31 s. The `timeout` the node passes is a per-request value this connector caps at 10 s, not a budget for the whole call. `reflector-node` bounds each `getPriceData` call from outside (at least 90 s, `getPriceFetchTimeout` in `src/domain/prices/trades-manager.js`): it stops waiting and drops a late answer, but cannot abort the call.

### Gateways

`setGateway(urls, validationKey, useCurrentProvider)` puts the connector into one of three states, and only the first of them issues a direct request:

- **No gateways configured** (`null`, `undefined` or an empty list): every request goes direct. An explicitly empty list counts as unconfigured rather than failed, because `reflector-node` writes `{urls: []}` the first time a node boots without a `gateways.json`.
- **At least one usable gateway**: one gateway per request, rotated round-robin per upstream host, with the `x-gateway-validation` header. Only that one gateway is tried — there is no walk over the remaining entries — and a request that fails over its gateway is not retried directly; the provider returns no data for that tick instead. `useCurrentProvider` puts the local host in the rotation as one more route of its own; that is a choice by the operator, not a fall-back, and it is the only thing that can put a direct route in the rotation — an `undefined` arriving in the configured list is rejected like any other non-string.
- **Gateways configured and none of them usable**: no route at all. An entry is usable only when it is a string that parses to a URL with a host, so `null`, `undefined`, an array hole, a number, an object, an array, a boolean, an empty or whitespace-only string and a url with no host (`mailto:`, `data:`, `foo:bar`) are all rejected; the log reason distinguishes them (`not-a-string (undefined)`, `not-a-string (object)`, `unparseable`, `no-host`). `setGateway` logs an error naming how many were configured and why each was dropped — never the entries themselves — and every request then fails with `RequestError` code `ERR_NO_GATEWAY` before any transport call.

`reflector-node` wires `setGateway` on the exchanges connector only, and that is by design: this connector reaches its upstreams directly. These states are therefore reachable here through a direct caller, not through the node.

Because only the rotated gateway is tried, the outcome of a request depends on rotation state whenever the gateway set is partially broken. Measured over `[healthy gateway, refused gateway]`, six requests to the same upstream host: a caller starting at rotation phase 0 got `OK, FAIL, OK, FAIL, OK, FAIL` and a caller one step further on got `FAIL, OK, FAIL, OK, FAIL, OK` — identical configuration, different data. For a direct caller that is a property to plan around; it would be a consensus divergence if this connector were ever wired into a node cluster, which it is not.

## Contract with reflector-node

`getPriceData({assets, baseAsset: 'USD', from, period, count, options})` returns `count` slots of `assets.length` arrays and populates only the last slot: a fixing is one sample per tick, not a candle series. `timestamp` is accepted as a deprecated alias of `from`.

## Tests

- `npm test`: offline (`nock` fixtures and a local HTTP server).
- `npm run test:integration`: live upstreams; `APILAYER_API_KEY` must be set for the apilayer suite.

