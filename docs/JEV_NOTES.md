# JEV_NOTES.md - Jev / TypeSafe knowledge pass

> Task T0.2 (Jev knowledge pass). Compiled 2026-10-01 from the live docs at https://docs.typesafe.ai/llms.txt.
> Scope: the facts the Centurion code must rely on (PLAN.md section 6), plus SDK facts needed for
> `JevGateway` (T2.1) and `jev-mock` (T2.2). All types below are written without `any`.

## 1. Endpoint and auth

| Item | Value |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Auth header | `Authorization: Bearer <API_KEY>` (env `TYPESAFE_API_KEY`) |
| Content type | `Content-Type: application/json` |
| Also available | `GET /v1/models` (lists aliases; versioned IDs are accepted even if not listed) |

## 2. Exact request shape

```ts
type JsonValue =
  | null | boolean | number | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// "Description" in the docs: a string, a JSON object, or a JSON array.
// (Structured descriptions put the question in one field and data in others;
//  reference them from the instruction in backticks, e.g. `potential_duplicate`.)
type Description = string | { [key: string]: JsonValue } | JsonValue[];

// HTTP API: state is required; text only (string / JSON object / array of text values).
type State = string | { [key: string]: JsonValue } | JsonValue[];

type NoulQuestion = {
  type: 'noul';
  instructions: Description;
  criteria?: { true?: Description; false?: Description }; // optional
};

type ChoiceQuestion = {
  type: 'choice';
  instructions: Description;
  criteria: { [option: string]: Description | null }; // null = label needs no description
};

type ScoreQuestion = {
  type: 'score';
  instructions: Description;
  criteria: Description[]; // ordered low -> high, 2..10 levels
};

type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

interface SystemOneRequest {
  state: State;                                  // required by the HTTP API
  model: string;                                 // required by the HTTP API, e.g. 'jev-1.13.0'
  questions: { [questionId: string]: Question }; // required, non-empty; keys are yours
}
```

Notes:
- Question ids are chosen by the caller, are **not** sent to the model, and are not used in inference.
  The answer comes back under the same id.
- `state` is evaluated once; every question sees the same state and is evaluated in parallel and
  in isolation. Adding questions barely changes latency (costs only the extra question tokens).
- The SDK helper factories are `noul(...)`, `choice(instructions, criteria)`, `score(...)`;
  the SDK request makes `model` optional (inherits `defaultModel`). Centurion always sends
  `JEV_MODEL` explicitly so responses are pinned.
- The SDK also accepts `state: null`; the HTTP API documents `state` as required. Centurion
  always sends a concrete state.

## 3. Exact response shape

```ts
interface NoulAnswer {
  type: 'noul';
  noul: number;             // probability the answer is yes, 0..1. Near 0.5 = genuinely unsure.
                            // Noul has NO confidence field.
}

interface ChoiceAnswer {
  type: 'choice';
  choice: string;           // argmax option (one of the question's criteria keys)
  probabilities: { [option: string]: number }; // full distribution over every option; sums to 1
  confidence: number;       // 0..1, derived from the distribution shape
}

interface ScoreAnswer {
  type: 'score';
  score: number;            // probability-weighted mean of level numbers, 0..(levels-1),
                            // may fall between levels (e.g. 1.43)
  legend: { [levelIndex: string]: Description }; // level number (as string) -> the level description
  probabilities: { [levelIndex: string]: number }; // over every level; sums to 1
  confidence: number;       // 0..1, derived from the distribution shape
}

type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

interface SystemOneResponse {
  model: string;                            // versioned id that answered, e.g. 'jev-1.13.0'
  answers: { [questionId: string]: Answer }; // one answer per question id
  usage: { input_tokens: number; output_tokens: number };
}
```

Example (exact documented response):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 },
      "confidence": 0.81
    },
    "frustration": {
      "type": "score",
      "score": 1.05,
      "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
      "confidence": 0.92
    },
    "is_urgent": { "type": "noul", "noul": 0.95 }
  },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```

## 4. The three primitives: answer shapes and limits

| Primitive | Question fields | Answer fields | Limits |
|---|---|---|---|
| **Noul** | `type`, `instructions`, optional `criteria.true`/`criteria.false` | `type`, `noul` (0..1) | no documented option limit; no `confidence` |
| **Choice** | `type`, `instructions`, `criteria` map | `type`, `choice`, `probabilities`, `confidence` | **max 255 options**. The docs state no minimum; Centurion enforces min 2 (PLAN section 5.2 says so explicitly). |
| **Score** | `type`, `instructions`, ordered `criteria` array | `type`, `score`, `legend`, `probabilities`, `confidence` | **2..10 levels** (API accepts up to 10) |

- `probabilities` always covers **every** option/level, including entries at 0.0, and sums to 1.
- Score `score` is the expectation of the level numbers, so different distributions can produce the
  same score. Read `probabilities` and `confidence` together with `score`.
- Score `legend` maps the string level index back to the **exact description supplied**. If a level
  was supplied as an object/array, the legend value is that object/array (not a string).

## 5. Token / context limits for jev-1.13.0

| Limit | Value |
|---|---|
| Context length | **64k tokens per request** total (state + all questions combined) |
| Per-question budget | **32k tokens** for `state` + the single **longest** question |
| Input modality | Text only. String, JSON object, or array of text values. No image/audio/video. |
| Tokenizer | None documented publicly. Use a conservative estimate (PLAN section 7.1 uses `ceil(chars/3)`) and calibrate against `usage.input_tokens`. |

The 64k budget covers state + every question; the 32k budget covers state + the single longest
question. A large irrelevant state both costs budget and lowers accuracy (see section 8).

## 6. Rate limits and cost

| Item | jev-1.13.0 |
|---|---|
| Requests | **40 requests / second** |
| Tokens | **100K tokens / second** |
| Price | **$42 / Btok** = **$0.042 / Mtok**, **input tokens only**; output tokens are free |
| Behaviour | Exceeding either limit returns `429`. Limits are **dynamic** and can change without notice. |

Because the limits are dynamic and explicitly unstable, they must be configuration
(`JEV_MAX_RPS` etc.), never hard-coded constants. SDKs honor `retry-after` / `retry-after-ms`
when present.

## 7. Error codes and retry guidance

Documented HTTP errors:

| Status | Meaning | Centurion handling (PLAN section 7.2) |
|---|---|---|
| `401 Unauthorized` | Missing or invalid API key | Fatal: stop consuming, fail `/ready` |
| `422 Unprocessable Entity` | Body failed validation (e.g. missing field, malformed question). Body details the offending field. | Bisect the question set, auto-disable the offending rule(s), rerun the rest |
| `429 Too Many Requests` | Rate limit exceeded | Back off, pause consumer, do NOT commit, redeliver |
| `529 Overloaded` | TypeSafe temporarily overloaded | Same as 429 |

The SDK exposes typed errors (all subclasses of `TypeSafeError`): `AuthenticationError`,
`BadRequestError`, `UnprocessableEntityError`, `RateLimitError`, `APIConnectionError`,
`APITimeoutError`, `InternalServerError`, `NotFoundError`, `PermissionDeniedError`, `APIError`.

Retry: retry `429`/`529` (and connection/timeout failures) with **exponential backoff**; do not
retry immediately. The SDK does this by default. SDK default `RetryPolicy`:

| Field | Default |
|---|---|
| `maxRetries` | 2 retries after the initial attempt (`0` disables) |
| `httpStatuses` | `408`, `429`, `500-599` |
| `backoffInitialMs` / `backoffMaxMs` | 500 / 5000, delay doubled each retry |
| `backoffJitter` | 0.25 (fraction of each delay randomly subtracted) |
| `respectRetryAfter` | true, capped by `maxRetryAfterMs` = 60000 |
| `apiConnectionError` / `apiTimeoutError` | true / true |
| `timeout` | 10000 ms **per attempt** (no total retry budget) |

## 8. Confidence semantics

- `confidence` exists on **Choice and Score only** (Noul's single value already describes its
  two-outcome distribution).
- `confidence` is a statistic of the returned `probabilities` distribution, collapsed to 0..1.
  A single peak = high confidence; a flat/spread distribution = low confidence.
- It describes the **model's answer distribution, not its correctness**. High confidence does not
  prove the answer is right.
- Full `probabilities` are always available, so a custom certainty statistic can be used instead.
- Documented usage pattern (three bands): high -> act automatically; medium -> review/confirm;
  low -> do not act (route to human). Thresholds are risk-dependent and live in code.
- Noul: threshold `noul` directly; use a middle band for review. Noul thresholds do **not**
  transfer to Choice probabilities (see section 9, item 8).

## 9. Known pitfalls / jaggedness (jev-1.13, last reviewed 2026-09-17)

1. **Literal reading.** It answers the question as written, not as intended. Put the exact
   condition in `instructions` and boundary cases in `criteria`.
2. **Math and counting are unreliable.** Do all arithmetic, counting, and numeric comparison in
   code. Numeric representations (hex colors, assembly, binary) perform worse than semantic ones.
3. **Date/time comparison is unreliable.** It reads dates as text, not ordered quantities. Extract
   date parts (ideally as Choices over enumerated values, with a "not stated" option) and compare in code.
4. **Indirection.** Double negatives and multi-hop reasoning reduce accuracy. Identify relevant
   state parts by name/path.
5. **Large state full of irrelevant detail.** Accuracy falls ("context rot") as unrelated content
   grows. Filter state in code first; a Noul relevance prefilter is a documented fallback.
6. **Adversarial content.** State is treated as data, not hostile input; injected instructions or
   self-serving framing can move answers. Write precise criteria, test edge cases, confidence-gate
   risky actions.
7. **Contradictory instructions/criteria.** e.g. a Noul whose `true` maps to "no" performs worse.
   Keep `criteria` aligned with the instruction.
8. **Structural invariants are not guaranteed.** Noul and Choice values are not interchangeable:
   the same question asked as a Noul vs a yes/no Choice can disagree (docs example: noul 0.22 but
   Choice yes 0.01). `P(noul) + P(not noul)` can exceed 1 (documented sum 1.19). Do not carry a
   threshold tuned on one primitive to another, and do not assume arithmetic identities between questions.
9. **No text generation.** Not trained to generate text. Turn extraction into a Choice over bounded
   options instead.
10. **Language.** English is the primary training language and where accuracy is best; other
    languages (incl. CJK) are accepted but weaker. Watch confidence when routing.
11. **Scores are not for magnitude reconstruction.** Score levels are weakly calibrated numerically;
    use a threshold, not interpolation, to recover an exact number.

## 10. Official JavaScript/TypeScript SDK (question b groundwork)

| Item | Value |
|---|---|
| Package name | **`@typesafe-ai/sdk`** |
| Latest version (at 2026-10-01) | **0.6.0**, published 2026-09-15 |
| Engine | Node.js **>= 20** |
| Modules | ESM + CommonJS + TypeScript declarations; MIT |
| Changelog | v0.6.0 breaking change: `Score.criteria` is an ordered sequence, not an integer-keyed dict |

Client configuration (`TypeSafeClientConfig`): `apiKey`, `baseURL`, `defaultModel`, `timeout`,
`retry`, `fetch`, `logger`, `logLevel`, `defaultHeaders`, `dangerouslyAllowBrowser`.
Explicit options take precedence over environment variables, which take precedence over defaults.

Environment variables the SDK reads:

| Env var | Purpose | Default |
|---|---|---|
| `TYPESAFE_API_KEY` | API key | (none; required) |
| `TYPESAFE_BASE_URL` | API root | `https://api.typesafe.ai` |
| `TYPESAFE_DEFAULT_MODEL` | default model | `jev-latest` |
| `TYPESAFE_LOG_LEVEL` | log level | `warn` |

**Base URL override: SUPPORTED.** Precedence is explicit `baseURL` option > `TYPESAFE_BASE_URL` >
`https://api.typesafe.ai`. The SDK does **not** read `JEV_BASE_URL`. To point `JevGateway` at the
local `jev-mock` using the plan's env var, construct the client explicitly:

```ts
const baseURL = process.env.JEV_BASE_URL; // must be wired by hand; SDK ignores it
const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY,
  ...(baseURL ? { baseURL } : {}),
  defaultModel: process.env.JEV_MODEL, // pin, e.g. 'jev-1.13.0'
});
```

The mock must therefore serve `POST <JEV_BASE_URL>/v1/systemone` (and ideally `GET /v1/models`).
Alternatively export both `JEV_BASE_URL` and `TYPESAFE_BASE_URL` with the same value.

## 11. Are response `model` and `usage` always present? (question b)

**Yes, per the contract.** Both are marked **required** in the HTTP API reference
(`model`, `answers`, `usage`) and are non-optional in the SDK types
(`readonly model: string`, `readonly usage: Usage`; `Usage = { input_tokens: number;
output_tokens: number }`). `model` reports the versioned id that actually answered, so it is the
authoritative record for pinning/drift detection. Treat them as always present, but still validate
the response at the boundary (zod) and fail into `JevValidationError` rather than trusting blindly,
because a future alias/mock/proxy could omit them.

## 12. Discrepancies vs PLAN.md section 6

**No material disagreement.** Every factual claim in PLAN.md section 6 was re-verified against the
live docs and holds:

- Endpoint, auth, request/response skeleton: confirmed.
- `{ state, model, questions: { <id>: Question } }` and `{ model, answers, usage }`: confirmed.
- 64k / 32k token budgets and text-only input: confirmed.
- 40 req/s and 100K tokens/s, explicitly dynamic: confirmed.
- 401/422/429/529 and exponential backoff on 429/529 (SDK default): confirmed.
- Input-token-only pricing (output free): confirmed.
- Confidence on Choice/Score only; high/medium/low gating by risk: confirmed.
- Noul has no confidence; Noul/Choice values are not interchangeable and thresholds do not
  transfer; no text generation; English strongest: confirmed by the jaggedness page.

Related discrepancies found **outside** section 6 (recorded in `docs/DECISIONS.md`):

1. **PLAN section 5.3** types `ScoreAnswer.legend` as `Record<string, string>`. The docs allow each
   legend value to echo the exact level description supplied, which may be an object or array when
   structured level descriptions are used. The contracts must accept `Description` values.
2. **PLAN section 8.4** lists `JEV_BASE_URL` as the mock override. The SDK supports base-URL
   override, but reads `TYPESAFE_BASE_URL` (or the `baseURL` option), not `JEV_BASE_URL`. The
   gateway must pass `JEV_BASE_URL` explicitly as `baseURL`.
3. Minor: the HTTP API requires `model`; the SDK makes it optional and defaults to `jev-latest`.
   Centurion should always send `JEV_MODEL`.

## 13. Strict-shape validation notes (no `any`)

- Mirror the types in sections 2-3 as zod discriminated unions on `type` and infer TS types from
  them (as PLAN section 5 already plans). Do not hand-write loose `Record<string, unknown>`.
- `Description` / `legend` values are recursive JSON. Model them as a recursive `JsonValue` zod
  schema; never cast to `any` or `unknown` in business code.
- Response parsing: validate that (a) `model` is a non-empty string, (b) every requested question id
  is present in `answers`, (c) each answer's `type` equals the question's `type`, and (d) Choice
  `choice` is a key of the request criteria while Score `legend`/`probabilities` keys are the
  level indices `0..n-1`. Unknown answer fields should be rejected or stripped explicitly.
- `probabilities` sums should be checked against 1 with a tolerance (floating point), not `===`.
- `usage` uses snake_case on the wire; map to `inputTokens`/`outputTokens` at the gateway
  boundary (PLAN section 6 `JevGateway`).

## 14. Sources (fetched 2026-10-01)

- Docs index: https://docs.typesafe.ai/llms.txt
- Introduction: https://docs.typesafe.ai/introduction
- API reference: https://docs.typesafe.ai/api
- Models / limits / pricing: https://docs.typesafe.ai/models
- Primitives: https://docs.typesafe.ai/primitives
- Choice: https://docs.typesafe.ai/primitives/choice
- Score: https://docs.typesafe.ai/primitives/score
- Noul: https://docs.typesafe.ai/primitives/noul
- Confidence: https://docs.typesafe.ai/confidence
- State: https://docs.typesafe.ai/concepts/state
- jev-1.13 jaggedness: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- JavaScript SDK: https://docs.typesafe.ai/sdk/javascript
- JS SDK config / retry / types: https://docs.typesafe.ai/sdk/javascript/api
- JS SDK changelog: https://docs.typesafe.ai/sdk/javascript/changelog
- Agent skill: https://docs.typesafe.ai/agent-skill
- npm registry: https://registry.npmjs.org/@typesafe-ai/sdk/latest
