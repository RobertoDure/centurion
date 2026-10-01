# PLAN.md — Centurion (Kafka → Jev → Rules → Actions)

```yaml
project: Centurion
audience: autonomous coding agent (Claude Code, Codex, or similar)
language: TypeScript (strict), Node >= 20
layout: pnpm monorepo
plan_version: 1.0
jev_docs_index: https://docs.typesafe.ai/llms.txt
```

---

## 0. Agent operating contract

Read this section first. It overrides anything ambiguous below.

1. Execute tasks in ID order, respecting `depends_on`. Tasks tagged `parallel-ok` may run in any order once their dependencies are met.
2. After every task run `pnpm -w typecheck && pnpm -w lint && pnpm -w test`. Commit as `<task-id>: <summary>`. Do not start the next task on a red build.
3. Never guess a third-party API. Read the installed package's types/README (`node_modules/<pkg>`), or the Jev docs (start at the docs index above). If docs and this plan disagree, the docs win; record the difference in `docs/DECISIONS.md`.
4. On ambiguity, take the default from §2, append a dated entry to `docs/DECISIONS.md`, and keep going. Stop and ask only when (a) a live credential is required for a check you cannot skip, or (b) two hard constraints in this plan conflict.
5. Never commit secrets. Ship `.env.example` only.
6. No `any`, no unchecked casts in business code. Validate every external boundary with zod: Kafka message, HTTP body, JSONB read from Postgres, Jev response.
7. All Jev access goes through `JevGateway` (§6). Never delegate arithmetic, date comparison, or counting to Jev; do those in code.
8. The rule engine is a set of pure functions with no I/O.
9. Business logic never lives in React components. Components render; hooks and `contracts` decide.

---

## 1. Goal, scope, non-goals

**Goal.** A log-monitoring system where any system can send logs (via a client library) to Kafka. A backend consumes them one by one, asks Jev to evaluate each log against user-defined rules, flags matches, and runs actions. A React + TypeScript dashboard manages the rules and shows what is happening live.

**In scope (MVP)**
- Client library that publishes log records to Kafka (single or batch).
- Backend Kafka consumer (sequential, at-least-once) that evaluates logs with Jev and persists flags.
- Rule management in the dashboard. Each rule is built from Jev primitive types (Noul, Choice, Score).
- Actions triggered when a rule is reached.
- Postgres persistence for rules, rule versions, actions, flags, and action executions.
- Live feed and flag history in the dashboard.

**Non-goals (MVP)**
- Storing raw logs long-term (this is not a log warehouse).
- Multi-tenant isolation, SSO, RBAC (leave an auth hook; see A7).
- Client libraries in languages other than TypeScript/Node (the envelope is a documented JSON schema so others can produce it).
- Generating text or explanations with Jev (it does not generate text; see §6).

---

## 2. Assumptions and defaults

Each item is a default the agent should adopt without asking. Change one only if the user says so.

| # | Assumption | Why |
|---|---|---|
| A1 | A browser cannot speak the Kafka protocol. "The dashboard consumes the queue" is implemented as: `apps/api` is the Kafka consumer, and it streams each processed message to the dashboard over Server-Sent Events (SSE). | Kafka is TCP-only; the Jev API key must also stay server-side. |
| A2 | One Kafka message = one log record (a versioned envelope, §5.1). `sendBatch()` in the client lib publishes many records using producer batching. Payload size is chosen by the sender. | Keeps "consume one by one" and per-message offsets simple. |
| A3 | The log `payload` becomes the Jev `state` (string, object, or array of text values). Non-semantic metadata (ids, timestamps) stays out of `state` unless a rule needs it. | Jev reads dates and numbers poorly and degrades with irrelevant state. |
| A4 | A rule = scope + ONE Jev question + ONE typed condition + actions. Rules stay atomic; boolean combination of rules is a stretch task (T8.5). | Jev's guidance: atomic questions, composed in code. |
| A5 | Postgres stores rules, rule versions, actions (required) plus flags and action executions (added: needed for the UI, audit, and retries). Raw log bodies are NOT stored by default; only a message reference and an optional short excerpt. | Logs often contain PII; avoids unbounded growth. |
| A6 | The client lib is TypeScript/Node first. | Same toolchain as the rest of the repo. |
| A7 | Auth is out of scope for the MVP, but every non-health route passes through an `authenticate` hook that is a no-op today. | Easy to add later without refactoring. |
| A8 | Pin the model to `jev-1.13.0` (not `jev-latest`) and log the `model` field of every response. | Aliases move; thresholds are tuned against a version. |
| A9 | MVP runs a single `apps/api` instance. | Multi-instance SSE fan-out is a stretch (T8.5). |

---

## 3. Architecture

```
 ┌────────────────┐   logs.raw    ┌──────────────────────────────────────────────┐
 │ Any system     │  (Kafka)      │ apps/api  (Node + TypeScript)                │
 │  + client-lib  ├──────────────►│  Kafka consumer (manual commit, sequential)  │
 └────────────────┘               │    ├─ validate envelope ──► logs.dlq (invalid)│
                                  │    ├─ rule cache (enabled rules)             │
                                  │    ├─ scope filter (code)                    │
                                  │    ├─ state builder + size guard             │
                                  │    ├─ question batcher ─► JevGateway ──► Jev │
                                  │    ├─ rule engine (pure) → verdicts          │
                                  │    ├─ persist flags + outbox (Postgres, tx)  │
                                  │    └─ commit offset, emit SSE event          │
                                  │  Action executor (outbox worker)             │
                                  │  REST API (rules, actions, flags, test)      │
                                  │  SSE stream  /api/v1/stream                  │
                                  └───────┬──────────────────────┬───────────────┘
                                          │ SQL                  │ REST + SSE
                                   ┌──────▼──────┐        ┌──────▼───────────────┐
                                   │ Postgres    │        │ apps/dashboard       │
                                   │ rules, ...  │        │ React + TypeScript   │
                                   └─────────────┘        └──────────────────────┘
```

Key point: the **only** component that talks to Jev is `apps/api`, through one request per log (or per question group), because Jev evaluates all questions in a request in parallel against the same state.

---

## 4. Stack and repository layout

Choose these unless a task says otherwise. Verify current stable versions at install time; do not hard-code versions from this plan.

| Concern | Choice |
|---|---|
| Package manager / monorepo | pnpm workspaces |
| Backend | Node 20+, Fastify, `fastify-type-provider-zod`, pino |
| Kafka client | Maintained KafkaJS-style client (prefer `@confluentinc/kafka-javascript`; `kafkajs` acceptable). Verify before choosing. |
| Jev client | `@typesafe-ai/sdk` (Node 20+). Env: `TYPESAFE_API_KEY`. Fall back to plain HTTP per the API reference if dynamic question typing fights the SDK's inference. |
| DB | Postgres, Drizzle ORM + drizzle-kit migrations |
| Validation / contracts | zod (shared package) |
| Frontend | Vite, React, TypeScript strict, React Router, TanStack Query, react-hook-form + zod resolver, Tailwind + shadcn/ui |
| Tests | Vitest, React Testing Library, MSW, Testcontainers (Kafka, Postgres), Playwright |
| Local infra | Docker Compose (Kafka KRaft single node, Postgres, jev-mock) |

```
log-monitor/
  apps/
    api/            # Kafka consumer + Jev evaluator + REST + SSE + action worker
    dashboard/      # React + TypeScript
    jev-mock/       # deterministic fake of POST /v1/systemone for tests/dev
  packages/
    contracts/      # zod schemas: envelope, Jev primitives, rules, actions, API DTOs (single source of truth)
    client-lib/     # log producer library (publishes to Kafka)
  infra/
    docker-compose.yml
    scripts/create-topics.sh
  docs/
    DECISIONS.md  JEV_NOTES.md  RULE_AUTHORING.md  openapi.json
  PLAN.md
```

---

## 5. Domain contracts (`packages/contracts`)

These are the boundaries of the system. UI forms, API bodies, DB JSONB columns, and Jev requests/responses all use these schemas. Jev's three primitive types are the discriminator everywhere.

### 5.1 Log envelope (Kafka message value, JSON)

```ts
LogEnvelope = {
  schemaVersion: 1,
  id: string,                       // ULID/UUID, idempotency key, generated by client lib
  source: { id: string; name?: string; environment?: string },
  timestamp: string,                // ISO-8601, set by client lib if absent
  level?: 'trace'|'debug'|'info'|'warn'|'error'|'fatal',
  payload: string | Record<string, JsonValue> | JsonValue[],   // becomes Jev `state`
  attributes?: Record<string, string>
}
```
Kafka key = `source.id`. Headers: `schema-version`, `content-type: application/json`.

### 5.2 Jev questions (what a rule asks)

```ts
Description   = string | Record<string, unknown> | unknown[]    // Jev accepts string | object | array

NoulQuestion   = { type: 'noul',   instructions: Description,
                   criteria?: { true?: Description; false?: Description } }
ChoiceQuestion = { type: 'choice', instructions: Description,
                   criteria: Record<string, Description | null> }  // 2..255 options (max is Jev's; min 2 is ours)
ScoreQuestion  = { type: 'score',  instructions: Description,
                   criteria: Description[] }                       // 2..10 levels (Jev's limits)

JevQuestion = z.discriminatedUnion('type', [NoulQuestion, ChoiceQuestion, ScoreQuestion])
```

### 5.3 Jev answers (what comes back)

```ts
NoulAnswer   = { type: 'noul',   noul: number /* 0..1 */ }                      // no confidence field
ChoiceAnswer = { type: 'choice', choice: string, probabilities: Record<string, number>, confidence: number }
ScoreAnswer  = { type: 'score',  score: number /* can fall between levels */,
                 legend: Record<string, string>, probabilities: Record<string, number>, confidence: number }
JevAnswer = z.discriminatedUnion('type', [NoulAnswer, ChoiceAnswer, ScoreAnswer])
```

### 5.4 Rule conditions (typed by the primitive they test)

```ts
NoulCondition   = { type: 'noul',   op: 'gte'|'lte', threshold: number /* 0..1 */ }
ChoiceCondition = { type: 'choice', anyOf: string[] /* ≥1 */, minProbability?: number /* 0..1 */, minConfidence?: number /* 0..1 */ }
ScoreCondition  = { type: 'score',  op: 'gte'|'lte', threshold: number /* ≥0 */, minConfidence?: number /* 0..1 */ }
RuleCondition = z.discriminatedUnion('type', [NoulCondition, ChoiceCondition, ScoreCondition])
```

### 5.5 Rule and Action

```ts
Rule = {
  id, name, description?, enabled: boolean, version: number,
  scope: { sources?: string[]; levels?: LogLevel[] },   // deterministic pre-filter in code, before Jev
  question: JevQuestion,
  condition: RuleCondition,
  uncertainPolicy: 'ignore' | 'review',                 // what to do when confidence is below minConfidence
  actionIds: string[]
}
```

Cross-field validation (`superRefine`, shared by UI, API, and DB reads):
- `condition.type === question.type`.
- Choice: every `anyOf` entry is a key of `question.criteria`.
- Score: `threshold ≤ criteria.length - 1`.
- Noul: `threshold` in `[0, 1]`.
- `minConfidence` is only valid for Choice and Score (Noul has no confidence).
- Choice has at most 255 options; Score has 2 to 10 levels.

```ts
ActionDefinition = {
  id, name, enabled,
  type: 'webhook' | 'kafka_topic',          // registry-based; more types are added by registering a handler
  config: WebhookConfig | KafkaTopicConfig  // discriminated by `type`; secrets are write-only via the API
}
```

### 5.6 Verdict semantics (the rule engine contract)

`evaluateRule(rule, answer) → 'TRIGGERED' | 'UNCERTAIN' | 'NOT_TRIGGERED'`

1. Compute `wouldTrigger` from the answer alone:
   - Noul: `noul` compared to `threshold` with `op`.
   - Choice: `choice ∈ anyOf` and, if set, `probabilities[choice] ≥ minProbability`.
   - Score: `score` compared to `threshold` with `op` (compare only; never interpolate a magnitude from a score).
2. If `!wouldTrigger` → `NOT_TRIGGERED`.
3. If `wouldTrigger` and `minConfidence` is set and `answer.confidence < minConfidence` → `UNCERTAIN`.
4. Otherwise → `TRIGGERED`.

`UNCERTAIN` with `uncertainPolicy: 'review'` persists a flag with outcome `uncertain` and does NOT run actions. With `'ignore'` it is dropped (counted in metrics).

---

## 6. Jev reference (verified against the docs; re-check if behavior differs)

- **Endpoint:** `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <API_KEY>`.
- **Request:** `{ state, model, questions: { <id>: JevQuestion } }`. `state` is a string, object, or array. Question ids are yours and are not sent to the model.
- **Response:** `{ model, answers: { <id>: JevAnswer }, usage: { input_tokens, output_tokens } }`.
- **Primitives:** Choice (pick one option, with probabilities and confidence), Score (rate on ordered levels, with probabilities and confidence), Noul (yes/no probability, no confidence).
- **Fan-out:** all questions in one request are evaluated in parallel and in isolation against the same state. Adding questions barely changes latency. Use one request per log carrying every in-scope rule's question.
- **Limits (jev-1.13.0):** 64k tokens per request (state + all questions); 32k tokens for state + the longest single question; text only. Rate limits are listed as 40 requests/s and 100K tokens/s and are explicitly **dynamic**, so make them config, not constants.
- **Errors:** 401 bad key, 422 malformed request, 429 rate limit, 529 overloaded. Retry 429/529 with exponential backoff (the SDKs do this by default).
- **Cost:** per input token only; output tokens are free.
- **Confidence:** Choice and Score only. Use it to gate actions: high → act, medium → review, low → do not act. Thresholds scale with risk.
- **Known weak spots (jaggedness):** reads questions literally; unreliable at counting, arithmetic, and date/time comparison; accuracy drops with large irrelevant state; can be steered by adversarial text inside the state; Noul and Choice values are not interchangeable and thresholds do not transfer between them; does not generate text; English is strongest.

### `JevGateway` (the only place that calls Jev)

```ts
interface JevGateway {
  evaluate(input: {
    state: JsonValue;
    questions: Record<string, JevQuestion>;
  }): Promise<{
    model: string;
    answers: Record<string, JevAnswer>;
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
// Errors mapped to: JevAuthError | JevRateLimitError | JevOverloadedError | JevValidationError | JevNetworkError
```

---

## 7. Pipeline semantics (per Kafka message, sequential)

1. **Receive** from `logs.raw` (manual offset commit; sequential by default, `CONSUMER_CONCURRENCY=1`).
2. **Validate** the envelope with zod. Invalid JSON/schema → publish to `logs.dlq` with header `reason=INVALID_ENVELOPE`, commit, continue.
3. **Select rules** from the in-memory rule cache (enabled rules only), then apply `scope` in code. No rules in scope → emit a "clean" SSE event, commit, continue (no Jev call).
4. **Build state** (`StateBuilder`) and run the **size guard** (§7.1).
5. **Batch questions** (`QuestionBatcher`) into request groups within token budgets. Question id = rule id.
6. **Call Jev** through `JevGateway`. Combine answers across chunks/groups (§7.1).
7. **Evaluate** every answer with the pure rule engine → verdicts.
8. **Persist in one DB transaction:** flags for `TRIGGERED` and `UNCERTAIN(review)`, plus one `action_executions` row (status `pending`) per `(flag, action)` for `TRIGGERED`. This is a transactional outbox.
9. **Commit the offset**, then emit SSE events (`log.processed`, `flag.created`).
10. The **action executor** (separate loop in the same process) claims pending rows with `FOR UPDATE SKIP LOCKED`, runs the handler, and retries with backoff.

**Delivery:** at-least-once. Duplicate deliveries are harmless: flags are unique on `(message_id, rule_id)`, and action executions are unique on `(flag_id, action_id)`.

### 7.1 Size guard (sender decides log size)

- Token estimate: no tokenizer is documented, so use a conservative heuristic (`ceil(chars / 3)`) and calibrate against `usage.input_tokens` from real responses (export the estimate/actual ratio as a metric).
- Budget: `stateTokens + maxQuestionTokens ≤ JEV_STATE_QUESTION_TOKEN_LIMIT × (1 − margin)` and `stateTokens + Σ questionTokens ≤ JEV_REQUEST_TOKEN_LIMIT × (1 − margin)`. If the question set exceeds the request budget, split rules into groups and send one request per group, sequentially.
- If the state alone is over budget, apply `OVERSIZE_POLICY`:
  - `chunk` (default): split into windows with small overlap, up to `MAX_CHUNKS`; a rule's verdict across chunks is the strongest one (`TRIGGERED` > `UNCERTAIN` > `NOT_TRIGGERED`). Mark the evaluation `partial=true` if the cap truncates.
  - `truncate`: keep head and tail, mark `partial=true`.
  - `reject`: send to `logs.dlq` with `reason=OVERSIZE`.

### 7.2 Failure handling

| Failure | Handling |
|---|---|
| Invalid envelope | DLQ `INVALID_ENVELOPE`, commit |
| Oversize | `OVERSIZE_POLICY` |
| Jev 429 / 529 | SDK backoff; if exhausted, pause the consumer for a backoff window, do NOT commit, redeliver; count in metrics |
| Jev 422 | Isolate the offending rule(s) by bisecting the question set, auto-disable them with `disabled_reason`, re-run the rest |
| Jev 401 | Fatal: stop consuming, fail `/ready`, show status in the UI |
| Postgres unavailable | Do not commit; retry with backoff |
| Action failure | Retry with exponential backoff up to `ACTION_MAX_ATTEMPTS`, then status `failed` (visible in UI) |

---

## 8. Interfaces and data

### 8.1 Kafka topics

| Topic | Purpose | Key |
|---|---|---|
| `logs.raw` | Input from client libs | `source.id` |
| `logs.dlq` | Rejected messages; headers `reason`, `original-topic`, `original-offset` | original key |
| `logs.flags` | Output of the `kafka_topic` action type | `rule.id` |

### 8.2 Postgres tables (Drizzle)

| Table | Key columns |
|---|---|
| `rules` | `id` uuid pk, `name`, `description`, `enabled`, `scope` jsonb, `question` jsonb, `condition` jsonb, `uncertain_policy`, `current_version`, `disabled_reason`, timestamps |
| `rule_versions` | pk `(rule_id, version)`, `snapshot` jsonb, `created_at` (every edit writes a new version in the same transaction) |
| `actions` | `id` uuid pk, `name`, `type`, `config` jsonb (secrets encrypted at rest), `enabled` |
| `rule_actions` | pk `(rule_id, action_id)`, `position` |
| `evaluations` | pk `message_id`, `source_id`, kafka `topic/partition/offset`, `model`, `token_estimate`, `partial`, `status`, optional `excerpt`. Written only for messages with a flag or an error unless `PERSIST_ALL_EVALUATIONS=true` |
| `flags` | `id` uuid pk, `message_id`, `rule_id`, `rule_version`, `outcome` (`triggered`/`uncertain`), `answer` jsonb, `created_at`, unique `(message_id, rule_id)` |
| `action_executions` | `id`, `flag_id`, `action_id`, `status` (`pending`/`running`/`succeeded`/`failed`), `attempts`, `next_attempt_at`, `last_error`, unique `(flag_id, action_id)` |

Every JSONB read is parsed with the matching `contracts` schema. A row that fails to parse is surfaced as `invalid` in the UI and skipped by the engine; it never crashes the consumer.

### 8.3 REST API (`/api/v1`, JSON, errors as problem+json)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/rules` | List, create |
| GET/PUT/DELETE | `/rules/:id` | Read, update (writes a version), delete |
| POST | `/rules/:id/enable`, `/disable` | Toggle |
| GET | `/rules/:id/versions` | History |
| POST | `/rules/test` | Dry run: `{ question, condition, uncertainPolicy?, sample }` → `{ answer, verdict }` (calls real Jev; rate-limited) |
| GET/POST/PUT/DELETE | `/actions`, `/actions/:id` | Manage actions (secrets never returned) |
| GET | `/flags`, `/flags/:id` | Filter by rule, source, outcome, time; paginated |
| GET | `/stream` | SSE: `log.processed`, `flag.created`, `consumer.status`; heartbeat; replay via `Last-Event-ID` from a ring buffer |
| GET | `/health`, `/ready`, `/metrics` | Ops |

### 8.4 Environment variables

`PORT`, `DATABASE_URL`, `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `KAFKA_TOPIC_RAW`, `KAFKA_TOPIC_DLQ`, `KAFKA_SASL_*` / `KAFKA_SSL_*`, `TYPESAFE_API_KEY`, `JEV_MODEL` (default `jev-1.13.0`), `JEV_BASE_URL` (override for the mock; confirm the SDK supports it), `JEV_MAX_RPS` (start conservative, tune), `JEV_STATE_QUESTION_TOKEN_LIMIT` (32000), `JEV_REQUEST_TOKEN_LIMIT` (64000), `TOKEN_SAFETY_MARGIN` (0.1), `OVERSIZE_POLICY`, `MAX_CHUNKS`, `CONSUMER_CONCURRENCY` (1), `PERSIST_ALL_EVALUATIONS` (false), `EXCERPT_CHARS` (0 = off), `RULE_CACHE_REFRESH_SECONDS`, `ACTION_MAX_ATTEMPTS`, `WEBHOOK_ALLOWED_HOSTS`, `SECRETS_ENCRYPTION_KEY`.

---

## 9. Tasks

Dependency overview: `P0 → (P1, P2, P6, P7-shell)` · `P1 + P2 → P3 → P4 → P5 → P7 (integration) → P8`.

### Phase 0 — Bootstrap and contracts

**T0.1 Monorepo bootstrap**
- depends_on: none
- do: pnpm workspace, shared `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint, Prettier, Vitest, root scripts `typecheck`, `lint`, `test`, `build`.
- accept: all root scripts pass on empty packages.

**T0.2 Jev knowledge pass**
- depends_on: none
- do: install the Jev agent skill (`npx skills add typesafe-ai/skills --skill typesafe-ai`, or the Claude Code plugin per https://docs.typesafe.ai/agent-skill). Read: introduction, API reference, models, confidence, state, jaggedness, and the JS SDK page. Write `docs/JEV_NOTES.md` (one page: shapes, limits, pitfalls).
- accept: file exists and matches §6; any discrepancy is logged in `docs/DECISIONS.md`.

**T0.3 Local infra**
- depends_on: T0.1
- do: `infra/docker-compose.yml` with Kafka (KRaft, single node), Postgres, and a placeholder for `jev-mock`; pin image tags. `infra/scripts/create-topics.sh` for the three topics.
- accept: `docker compose up -d` is healthy; topics exist.

**T0.4 Contracts package**
- depends_on: T0.1
- do: implement §5 as zod schemas, inferred TS types, cross-field refinements, and `evaluateRule` types. Export JSON Schema for the log envelope (for non-TS producers).
- accept: table-driven tests per primitive (valid and invalid cases, including every cross-field rule in §5.5); 100% of schema branches covered.

### Phase 1 — Persistence

**T1.1 Schema and migrations** (depends_on: T0.3, T0.4)
- do: Drizzle schema for §8.2; migration scripts; `pnpm db:migrate`.
- accept: migrates a clean DB; unique constraints present.

**T1.2 Repositories** (depends_on: T1.1)
- do: rules (create/update inside a transaction that also writes `rule_versions`), actions, flags, action executions, evaluations. Parse every JSONB read with `contracts`.
- accept: Testcontainers integration tests, including: update creates version N+1; invalid stored JSON yields an `invalid` marker, not an exception; duplicate flag insert is a no-op.

### Phase 2 — Jev integration

**T2.1 JevGateway** (depends_on: T0.4)
- do: SDK-backed implementation; model from `JEV_MODEL`; map errors to the domain errors in §6; return `model` and usage; token-bucket limiter driven by `JEV_MAX_RPS`.
- accept: unit tests with a fake transport for each error class; no other module imports the SDK.

**T2.2 jev-mock** (depends_on: T0.4; parallel-ok)
- do: Fastify server implementing `POST /v1/systemone` with the real request/response shape. Deterministic answers from keyword fixtures. Switches to simulate 429, 529, 422, and latency.
- accept: runs in Docker Compose; validates incoming requests against `contracts`.

**T2.3 StateBuilder, token estimator, size guard** (depends_on: T0.4)
- do: §7.1 including `chunk`, `truncate`, and `reject`; keep non-semantic metadata out of state by default.
- accept: unit tests at the boundaries (just under, equal to, just over budget; multi-chunk; cap reached sets `partial`).

**T2.4 QuestionBatcher** (depends_on: T2.3)
- do: group rule questions into requests within both token budgets; question id = rule id.
- accept: property-style tests: no group exceeds either budget; every rule appears in exactly one group.

**T2.5 Invalid-rule isolation** (depends_on: T2.1, T1.2)
- do: on 422, bisect the question set to find the offending rule(s); auto-disable them with `disabled_reason`; continue with the rest.
- accept: integration test with jev-mock returning 422 for one bad rule among five; the other four are evaluated.

### Phase 3 — Rule engine and actions

**T3.1 Rule engine** (depends_on: T0.4)
- do: pure `evaluateRule` per §5.6 and `selectInScope(rules, envelope)`.
- accept: exhaustive table tests: threshold equality, confidence equal to `minConfidence`, choice not in `anyOf`, `minProbability` below and above, Score at level boundaries, Noul extremes.

**T3.2 Action registry and handlers** (depends_on: T1.2)
- do: `ActionHandler` interface and registry. Handlers: `webhook` (JSON body, HMAC-SHA256 signature header, timeout, SSRF guard that blocks private/loopback ranges unless host is in `WEBHOOK_ALLOWED_HOSTS`) and `kafka_topic`. Action payload: `{ flagId, rule: { id, name, version }, source, messageRef, answer, triggeredAt, excerpt? }`.
- accept: unit tests per handler; SSRF guard test cases (IPv4, IPv6, DNS to private ranges).

**T3.3 Action executor** (depends_on: T3.2)
- do: outbox worker using `FOR UPDATE SKIP LOCKED`, exponential backoff with jitter, `ACTION_MAX_ATTEMPTS`, idempotent execution.
- accept: integration test: handler fails twice then succeeds (3 attempts, final `succeeded`); permanent failure ends as `failed`; killing the worker mid-run does not lose or duplicate an execution.

### Phase 4 — Ingestion pipeline

**T4.1 Consumer wrapper** (depends_on: T0.3)
- do: manual commits, sequential processing by default, optional bounded concurrency, pause/resume, graceful shutdown (finish in-flight message, commit, disconnect).
- accept: integration test with real Kafka: offsets commit only after the DB transaction.

**T4.2 Rule cache** (depends_on: T1.2)
- do: in-memory snapshot of enabled, valid rules; invalidated directly on rule mutations in the same process and refreshed every `RULE_CACHE_REFRESH_SECONDS`.
- accept: a rule edit takes effect on the next message without a restart.

**T4.3 Pipeline orchestrator and DLQ** (depends_on: T2.x, T3.1, T4.1, T4.2)
- do: implement §7 steps 1–10 and the failure table in §7.2. Attach `rule_version` and `model` to every persisted result.
- accept: end-to-end integration test (Kafka + Postgres + jev-mock): produce ~100 logs including invalid JSON, oversize, flagged, uncertain, and clean ones. Assert flags, DLQ entries, action executions, and offsets. Re-deliver the same messages and assert no duplicate flags or executions.

### Phase 5 — API and streaming

**T5.1 REST API** (depends_on: T1.2, T4.2)
- do: routes in §8.3 using zod type provider; `authenticate` no-op hook; problem+json errors; secrets write-only.
- accept: route tests; invalid bodies return 422 with field paths from the shared schema errors.

**T5.2 Rule dry-run** (depends_on: T2.1, T3.1)
- do: `POST /rules/test` builds state from the sample, asks Jev, and returns the raw typed answer plus the verdict. Rate-limit it.
- accept: works against jev-mock; refuses when `question`/`condition` types mismatch.

**T5.3 SSE hub** (depends_on: T4.3)
- do: event types in §8.3, heartbeat, ring buffer (default 500) with `Last-Event-ID` replay, slow-client protection.
- accept: reconnect replays missed events; a stalled client does not block the consumer.

**T5.4 Ops and OpenAPI** (depends_on: T5.1)
- do: `/health`, `/ready` (DB, Kafka, Jev auth state), `/metrics` (consumer lag, messages processed, Jev latency, 429/529 counts, verdict counts, DLQ count, estimate/actual token ratio). Generate `docs/openapi.json` from the zod schemas.
- accept: spec generated in CI; metrics visible after the T4.3 scenario.

### Phase 6 — Client library (`parallel-ok` after T0.4)

**T6.1 LogClient**
- depends_on: T0.4
- do: public API:
  ```ts
  const logs = new LogClient({ brokers, topic: 'logs.raw', source: { id, environment }, auth?, compression?,
                               batch: { maxRecords, lingerMs, maxBufferBytes }, failureMode: 'drop' | 'throw' | 'callback' });
  await logs.send({ level, payload, attributes });
  await logs.sendBatch([...]);
  await logs.flush(); await logs.close();
  ```
  Generates `id` and `timestamp`, validates with `contracts`, keys by `source.id`, sets headers.
- accept: unit tests with a fake producer.

**T6.2 Reliability** (depends_on: T6.1)
- do: buffering with bounded memory and backpressure, retry with backoff, `onError` callback; the lib must not crash the host app by default (`failureMode: 'drop'` with a counter). No client-side size cap; large payloads are legal (the server applies §7.1), but emit a warning above a configurable size.
- accept: integration test against Compose Kafka; broker-down scenario neither throws nor leaks memory.

**T6.3 Packaging and docs** (depends_on: T6.2)
- do: ESM + CJS builds with type declarations, README with examples, example app.
- accept: example sends 1k records in batches; they appear on `logs.raw`.

### Phase 7 — Dashboard (`parallel-ok` after T0.4 using MSW; integrate after Phase 5)

**T7.1 App shell** (depends_on: T0.4)
- do: Vite + React + TS strict, routing, layout, typed API client built on `contracts`, TanStack Query, error boundary, MSW handlers mirroring §8.3.
- accept: renders against MSW.

**T7.2 Rules list** (depends_on: T7.1)
- do: table with enable/disable, `invalid` and auto-disabled badges (with `disabled_reason`), version history drawer.

**T7.3 Rule editor** (depends_on: T7.2)
- do: step-based form built on react-hook-form + the shared zod schemas:
  1. Scope (sources, levels).
  2. Question: a type switch (**Noul / Choice / Score**) with a builder per type: Noul true/false descriptions; Choice option list with descriptions (max 255); Score ordered level list (2–10). Inline guidance from `docs/RULE_AUTHORING.md`: be literal and specific, one judgment per rule, no arithmetic/date/counting conditions.
  3. Condition, locked to the question type: Noul = op + 0..1 threshold; Choice = multi-select of options defined in step 2, optional min probability/confidence; Score = op + threshold bounded by the level count, optional min confidence. Changing the question type resets the condition.
  4. Actions (multi-select) and `uncertainPolicy`.
  5. **Test panel**: paste a sample log, call `/rules/test`, show the typed answer (probabilities, confidence) and the verdict.
- accept: component tests prove that invalid combinations cannot be submitted (e.g. Choice condition referencing a removed option; Score threshold above the top level).

**T7.4 Actions management** (depends_on: T7.1)
- do: CRUD for actions; webhook secret is write-only; show last execution status.

**T7.5 Live feed and flags** (depends_on: T7.1, T5.3)
- do: SSE hook with auto-reconnect and `Last-Event-ID`; virtualized live list (cap 500 rows) with status badges (clean / flagged / uncertain / error / partial); flags page with filters, pagination, and answer details (probabilities, confidence, rule version, action execution status).

**T7.6 System status** (depends_on: T5.4)
- do: consumer status, lag, Jev error rate, DLQ count, auth/key problems surfaced prominently.

**T7.7 Frontend tests** (depends_on: T7.3, T7.5)
- do: RTL for editor/validation; Playwright smoke: create a rule, see the test panel verdict, see a flag appear.

### Phase 8 — Hardening and delivery

**T8.1 End-to-end scenario** (depends_on: T4.3, T5.x, T6.3, T7.x)
- do: `pnpm e2e`: Compose up → create an action and a rule via API → produce logs with the client lib → assert a flag in the API and a signed webhook received by a test receiver.
- accept: green in CI with jev-mock.

**T8.2 Load and soak** (depends_on: T4.3)
- do: 10k messages with injected latency and periodic 429/529 from jev-mock.
- accept: zero message loss, no duplicate flags, bounded memory, lag recovers after throttling.

**T8.3 Adversarial pack** (depends_on: T4.3)
- do: logs containing instruction-like text, misleading framing, and very long lines. Assert the pipeline stays stable and verdicts are recorded. If `TYPESAFE_API_KEY` is available, run the pack live (`JEV_LIVE_TESTS=1`) and record results in `docs/JEV_NOTES.md`.
- accept: documented findings; no crashes.

**T8.4 Docs** (depends_on: all)
- do: README (run locally, config), runbook (DLQ handling, key rotation, throttling), `docs/RULE_AUTHORING.md` (see §10), ADRs in `docs/DECISIONS.md`.

**T8.5 Stretch (only after DoD is met)**
- Composite rules: AND/OR over several atomic rule verdicts, evaluated in code.
- Noul-based relevance prefilter for large states.
- Multi-instance SSE fan-out (Postgres LISTEN/NOTIFY).
- Auth (OIDC) behind the existing hook.
- More actions (Slack, email).

---

## 10. Rule authoring guidance (ship as `docs/RULE_AUTHORING.md` and surface in the editor)

- One judgment per rule. If a rule needs "and"/"or", make two rules (composition is code).
- State the exact condition. Jev reads literally; put boundary cases in the criteria.
- Keep instructions and criteria aligned (a Noul whose `true` means "no" performs worse).
- Never ask Jev to count, add, or compare numbers or dates. Do that in code or pre-compute fields into the log payload.
- Prefer Choice with an explicit "none of these" option over open-ended questions; use Score only for ordered severity, and only threshold on it.
- Do not reuse a threshold across question types (a Noul threshold is not a Choice probability).
- Use `minConfidence` on Choice/Score rules that trigger risky actions; use `uncertainPolicy: 'review'` to keep uncertain hits visible.
- Test every rule in the test panel with at least one positive and one negative sample before enabling it.

---

## 11. Cross-cutting requirements

- **Security:** Jev key and DB credentials only in the backend. Webhook secrets encrypted at rest and never returned. SSRF guard on webhooks. Treat all log content as untrusted data (it may contain text aimed at steering the model); never let a single Jev answer directly trigger a high-risk action without a confidence gate.
- **Privacy:** raw logs are not persisted by default; excerpts are opt-in (`EXCERPT_CHARS`). Redact configured field names before building state (optional `redactKeys` config).
- **Observability:** structured pino logs with `messageId`, `ruleId`, `model`; the metrics listed in T5.4; correlation id from Kafka message to flag to action execution.
- **Performance:** one Jev request per log (or per question group), rules pre-filtered by scope, rule cache in memory, bounded buffers everywhere, consumer pause on sustained 429.
- **Compatibility:** `schemaVersion` on the envelope; consumer rejects unknown major versions to the DLQ with a clear reason.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Jev rate limits change without notice | All limits are config; backoff; consumer pause; metrics on 429/529 |
| Large or noisy logs reduce accuracy and can exceed context | Size guard, scope pre-filter, chunking with `partial` flag, optional relevance prefilter (stretch) |
| Prompt-injection-style content in logs | Literal, specific criteria; confidence gating; adversarial test pack (T8.3); no high-risk action on a single ungated answer |
| Model alias drift changes verdicts | Pin `jev-1.13.0`; store `model` with every result |
| A malformed rule breaks every request | Shared validation at the UI, API, and DB-read boundaries; 422 bisect and auto-disable (T2.5) |
| Duplicate processing on redelivery | Idempotent keys on flags and executions; offset commit after the transaction |
| Authors write rules Jev handles poorly (math, dates, counting) | Editor guidance, `RULE_AUTHORING.md`, test panel before enabling |

---

## 13. Definition of done

- [ ] `pnpm -w typecheck && pnpm -w lint && pnpm -w test` are green; coverage for `contracts` and the rule engine is effectively complete.
- [ ] `docker compose up` + `pnpm e2e` demonstrates: create rule (each of Noul, Choice, Score) → send logs via client lib → flags appear live in the dashboard → webhook delivered.
- [ ] A Choice rule cannot reference an option that does not exist; a Score rule cannot have a threshold above its top level; a Noul rule cannot carry `minConfidence` (enforced identically in UI, API, and DB reads).
- [ ] Redelivered messages produce no duplicate flags or action executions.
- [ ] Invalid and oversize messages land in `logs.dlq` with a reason (or follow the configured oversize policy).
- [ ] Jev 429/529 throttling is survived without message loss.
- [ ] No Jev call exists outside `JevGateway`; no secret is committed; `.env.example` is complete.
- [ ] `docs/DECISIONS.md` lists every default taken from §2 and every deviation from the docs.

---

## 14. Sources

- Jev introduction: https://docs.typesafe.ai/introduction
- Docs index (for agents): https://docs.typesafe.ai/llms.txt
- API reference: https://docs.typesafe.ai/api
- Models, limits, pricing: https://docs.typesafe.ai/models
- Confidence: https://docs.typesafe.ai/confidence
- State: https://docs.typesafe.ai/concepts/state
- jev-1.13 jaggedness: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- JavaScript SDK: https://docs.typesafe.ai/sdk/javascript
- Agent skill: https://docs.typesafe.ai/agent-skill
