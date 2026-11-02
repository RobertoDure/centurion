# DECISIONS.md

Dated decisions and deviations from PLAN.md, per the agent operating contract (PLAN.md section 0.3,
section 0.4). Newest entries are appended at the bottom.

## 2026-10-01 - Score legend values may be structured (deviation from PLAN.md section 5.3)

PLAN.md section 5.3 types `ScoreAnswer.legend` as `Record<string, string>`. The live docs
(https://docs.typesafe.ai/primitives/score and https://docs.typesafe.ai/api) state that when a Score
level's `criteria` entry is supplied as an object or array, the answer's `legend` maps that level
number to the exact description supplied, i.e. an object/array rather than a string. The
`contracts` package must therefore type `legend` values as `Description`
(`string | { [key: string]: JsonValue } | JsonValue[]`), not `string`. The rule engine only ever
compares `score`/`confidence`, so this does not affect verdict logic, but it does affect response
validation and the flag payload shown in the UI.

## 2026-10-01 - `JEV_BASE_URL` must be passed to the SDK explicitly (deviation from PLAN.md section 8.4)

PLAN.md section 8.4 defines `JEV_BASE_URL` as the override used to point at the local mock, and asks
to confirm SDK support. The official JS SDK (`@typesafe-ai/sdk@0.6.0`) does support overriding the
base URL, but it reads the `TYPESAFE_BASE_URL` environment variable (or the `baseURL` constructor
option); it does not read `JEV_BASE_URL`. Decision: keep the project-facing `JEV_BASE_URL` env var,
and have `JevGateway` pass it explicitly as `baseURL` when constructing `TypeSafeClient`
(or export both variables). The mock must serve `POST <JEV_BASE_URL>/v1/systemone`.

## 2026-10-01 - Jev knowledge pass (T0.2); PLAN.md section 6 confirmed

Re-verified every claim in PLAN.md section 6 against the live Jev docs. No material disagreements
were found: endpoint/auth, request/response skeleton, 64k/32k token budgets, text-only input,
40 req/s / 100K tokens/s dynamic rate limits, 401/422/429/529 error codes, exponential backoff on
429/529, input-token-only pricing, Choice/Score-only confidence, Noul having no confidence,
non-interchangeable Noul/Choice values, no text generation, and English-strongest all match.
Details and the two related deviations above are recorded in `docs/JEV_NOTES.md`.

## 2026-10-01 - Kafka client: @confluentinc/kafka-javascript

PLAN.md section 4 prefers a maintained KafkaJS-style client. `kafkajs@2.2.4` was last
published in 2023; `@confluentinc/kafka-javascript@1.10.1` was published 2026-09-10 and is
actively maintained. Decision: use `@confluentinc/kafka-javascript` for both `apps/api`
and `packages/client-lib`.

## 2026-10-01 - TypeScript pinned to 6.x

The registry's `typescript@latest` is 7.0.2, but `typescript-eslint@8.71.0` refuses to run
against TS 7.0 ("typescript-eslint does not support TS 7.0"). Decision: pin the workspace to
`typescript@^6` so lint and typecheck share one compiler. Revisit when typescript-eslint
supports TS >= 7.1.

## 2026-10-01 - Rule enable/disable does not create a new rule version

An edit to a rule's content (question, condition, scope, actions, policy) writes a new
`rule_versions` row and bumps `current_version`. Toggling `enabled` (or setting
`disabled_reason` after a 422) is an operational action and does not consume a version.

## 2026-10-01 - Description is JSON-serialisable

PLAN.md section 5.2 defines `Description` as `string | Record<string, unknown> | unknown[]`.
Because every description crosses a JSON boundary (DB JSONB, HTTP, Jev), contracts narrows
this to `string | Record<string, JsonValue> | JsonValue[]`. This rejects non-serialisable
descriptions at the boundary instead of failing later.

## 2026-10-01 - Action DTO rejects a leaked secret

The `webhook` action DTO schema omits `secret` and is strict, so building a response that
still contains the secret throws instead of silently shipping it. The repository exposes the
plaintext secret only through the execution path.

## 2026-10-01 - Empty scope lists mean "no restriction"

A rule scope with `sources: []` or `levels: []` matches everything. Clearing a list in the
UI must not silently disable a rule; the user removes the rule or disables it explicitly.

## 2026-10-01 - Kafka client: kafkajs (supersedes the Confluent decision above)

PLAN.md section 4 prefers `@confluentinc/kafka-javascript`, and we initially selected it. It cannot
run in this environment: the package has no prebuilt native binary for Node 25 (ABI 141; prebuilts
stop at ABI 137 / Node 24) and building from source fails because libcurl/openssl development
headers are unavailable. `kafkajs@2.2.4` is pure JavaScript, runs on Node 25, and section 4
explicitly allows it. Decision: use `kafkajs` for both apps/api and packages/client-lib. Revisit
if the project pins Node 24 or the Confluent client ships a Node 25 prebuilt.

## 2026-10-01 - Dashboard UI primitives hand-written instead of shadcn/ui CLI

(Recorded when the dashboard lands.) The dashboard uses Tailwind plus small local UI primitives
rather than running the interactive shadcn/ui generator, keeping the build reproducible and offline.
