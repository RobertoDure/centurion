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
