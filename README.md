# Centurion

Send logs from any system to Kafka. Centurion consumes them one by one, asks
[Jev](https://docs.typesafe.ai) to evaluate each log against your rules, flags the matches and runs
actions. A React dashboard manages the rules and shows what is happening live.

```
 client-lib ──logs.raw──►  apps/api (Kafka consumer)
                             ├─ validate envelope ──► logs.dlq (invalid)
                             ├─ rule cache + scope pre-filter (code)
                             ├─ state builder + size guard
                             ├─ JevGateway ──► Jev (or jev-mock)
                             ├─ rule engine (pure) → verdicts
                             ├─ flags + action outbox (one Postgres transaction)
                             └─ commit offset → SSE
                           action executor (outbox worker)
                           REST API + SSE  ──►  apps/dashboard (React)
```

Only `apps/api` talks to Jev. Only `@centurion/contracts` defines the boundaries: every Kafka
message, HTTP body, JSONB read and Jev response is validated with zod.

## Layout

```
apps/api          Kafka consumer + Jev evaluator + REST + SSE + action worker
apps/dashboard    React + TypeScript dashboard
apps/jev-mock     deterministic fake of POST /v1/systemone for dev and tests
packages/contracts  zod schemas + rule engine (single source of truth)
packages/client-lib log producer library
infra             docker compose (Kafka KRaft, Postgres, jev-mock) + topic script
docs              DECISIONS.md, JEV_NOTES.md, RULE_AUTHORING.md, RUNBOOK.md, openapi.json
```

## Prerequisites

- Node >= 20 and pnpm
- Docker (for Kafka, Postgres and jev-mock)
- A `TYPESAFE_API_KEY` only for live Jev; local development uses jev-mock.

## Quick start

```bash
pnpm install
pnpm infra:up                 # Kafka, Postgres, jev-mock
cp .env.example .env          # DATABASE_URL and JEV_BASE_URL are already set for local
pnpm db:migrate
pnpm --filter @centurion/api dev       # API on :3000, consuming logs.raw
pnpm --filter @centurion/dashboard dev # dashboard on :5173
```

Send a log:

```ts
import { LogClient } from '@centurion/client-lib';

const logs = new LogClient({
  brokers: ['localhost:9092'],
  topic: 'logs.raw',
  source: { id: 'checkout-api', environment: 'local' },
});

await logs.send({ level: 'error', payload: 'payment declined by issuer' });
await logs.close();
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm typecheck` | strict TypeScript across the workspace |
| `pnpm lint` | ESLint |
| `pnpm test` | unit tests for every package |
| `pnpm build` | build packages that emit artifacts |
| `pnpm infra:up` / `infra:down` | start/stop local infra |
| `pnpm infra:topics` | create the three Kafka topics |
| `pnpm --filter @centurion/api test:integration` | Testcontainers + real Kafka/Postgres/jev-mock |
| `pnpm --filter @centurion/api db:generate` | generate a Drizzle migration |

## Configuration

All configuration is environment variables; see [.env.example](.env.example) for the complete list.
Highlights:

- `JEV_MODEL` is pinned to `jev-1.13.0` and the `model` of every response is stored with the result.
- `JEV_BASE_URL` points the gateway at jev-mock locally. The SDK does not read this variable, so the
  gateway passes it explicitly as `baseURL`.
- Token budgets (`JEV_STATE_QUESTION_TOKEN_LIMIT`, `JEV_REQUEST_TOKEN_LIMIT`,
  `TOKEN_SAFETY_MARGIN`) and the oversize policy (`chunk` | `truncate` | `reject`) control the size
  guard. Token counts use a conservative `ceil(chars / 3)` heuristic calibrated against real usage.
- Webhook secrets are encrypted at rest with `SECRETS_ENCRYPTION_KEY` and never returned by the API.
- Raw log bodies are not stored; excerpts are opt-in via `EXCERPT_CHARS`.

## Delivery semantics

At-least-once. Offsets commit only after the database transaction, flags are unique on
`(message_id, rule_id)` and action executions on `(flag_id, action_id)`, so redelivery is harmless.

## Documentation

- [Rule authoring](docs/RULE_AUTHORING.md) - how to write rules Jev handles well
- [Runbook](docs/RUNBOOK.md) - DLQ handling, throttling, key rotation, action retries
- [Jev notes](docs/JEV_NOTES.md) - verified API shapes, limits and pitfalls
- [Decisions](docs/DECISIONS.md) - every default taken and deviation from the plan
- [OpenAPI](docs/openapi.json) - generated from the zod schemas

## Definition of done

See PLAN.md section 13. `pnpm typecheck && pnpm lint && pnpm test` must be green, coverage for
`contracts` and the rule engine is complete, and `pnpm e2e` demonstrates create rule → send logs →
flag appears → webhook delivered.
