# @centurion/jev-mock

A deterministic local stand-in for TypeSafe Jev's `POST /v1/systemone`, used by dev
and test environments (and by Docker Compose as the `jev-mock` service). It is a
Fastify server that validates requests with the zod schemas from
`@centurion/contracts` and returns a response that always satisfies
`jevApiResponseSchema`.

## Endpoints

| Method | Path            | Purpose                                                  |
| ------ | --------------- | -------------------------------------------------------- |
| `GET`  | `/health`       | Liveness probe: `{ "status": "ok" }`                     |
| `POST` | `/v1/systemone` | The mocked Jev endpoint                                  |
| `POST` | `/__mock/mode`  | Body `{ "mode": "..." }` sets the global mode at runtime |
| `GET`  | `/__mock/stats` | `{ counts, total }` grouped by HTTP status               |

## Deterministic answers

Every question id present in the request is answered, and only those ids. The
request's `model` is echoed back. `usage.input_tokens = max(1, ceil(JSON length / 3))`
and `usage.output_tokens = 1 + number of answers` (this feeds the gateway's token
calibration metric).

### Noul

Noul answers carry **no** `confidence` field. The probability is chosen from
keywords found in the lower-cased JSON-stringified state. First match wins:

| Keyword in state         | `noul` |
| ------------------------ | ------ |
| `payment declined`       | `0.93` |
| `timeout` or `timed out` | `0.9`  |
| (none of the above)      | `0.2`  |

### Choice

The winner is the first criteria key whose lower-cased name appears in the state
text; if none matches, the first criteria key is used. `probabilities` covers
every option and sums to 1; `confidence` is 0.8 for a keyword match and 0.5
otherwise.

### Score

`score` is a level index in `0..criteria.length - 1`; `legend` maps each string
level index to the exact description supplied. `probabilities` covers every level
and sums to 1. The chosen level is the top level for `payment declined`, the
second-from-top for `timeout`/`timed out`, and the middle level otherwise.

## Failure and latency simulation

Modes are `429`, `529`, `422`, `latency`, and `ok`. `429` and `529` return the
matching HTTP status plus an RFC 9457 `application/problem+json` body. `422`
simulates a rejected request. `latency` waits `JEV_MOCK_LATENCY_MS` (default 250)
and then answers normally. `ok` is the normal path (and the default).

Precedence, highest first:

1. Per-request: header `x-jev-mock-mode` or query string `?mode=`.
2. Global runtime mode set by `POST /__mock/mode`.
3. `JEV_MOCK_ALWAYS` environment variable.
4. `JEV_MOCK_429_EVERY=N`: fail every Nth request with 429.
5. `ok`.

Simulation is opt-in only; with no configuration the mock always answers normally.

## Environment variables

| Name                  | Default | Meaning                          |
| --------------------- | ------- | -------------------------------- |
| `PORT`                | `8080`  | Listen port (host `0.0.0.0`)     |
| `JEV_MOCK_LATENCY_MS` | `250`   | Delay used by the `latency` mode |
| `JEV_MOCK_ALWAYS`     | (unset) | Force a mode on every request    |
| `JEV_MOCK_429_EVERY`  | (unset) | Fail every Nth request with 429  |

## Development

```sh
pnpm --filter @centurion/jev-mock typecheck
pnpm --filter @centurion/jev-mock test
pnpm --filter @centurion/jev-mock start
```

## Docker

The image is built from the repository root (the Compose file lives in `infra/`):

```sh
docker compose -f infra/docker-compose.yml build jev-mock
docker compose -f infra/docker-compose.yml up -d --no-deps jev-mock
curl -sS -X POST http://localhost:8080/v1/systemone \
  -H 'content-type: application/json' \
  -d '{"state":{"message":"payment declined"},"model":"jev-1.13.0","questions":{"is_urgent":{"type":"noul","instructions":"Is this urgent?"}}}'
```

The server runs through `tsx`, so the source-exported `@centurion/contracts`
package needs no build step.

## Why manual body validation?

The task allows `fastify-type-provider-zod` only if it supports zod 4. Rather than
depend on a third-party adapter's zod 4 compatibility, the handler validates with
`jevApiRequestSchema.safeParse` directly, which keeps the contracts as the single
source of truth and produces the zod issue paths used in the 422 response.
