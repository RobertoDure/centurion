# Runbook

## Services

| Component | Port | Notes |
|---|---|---|
| API | 3000 | REST + SSE (`/api/v1/stream`) |
| Dashboard | 5173 | Vite dev server, proxies `/api` to the API |
| Kafka | 9092 | KRaft single node |
| Postgres | 5432 | |
| jev-mock | 8080 | local stand-in for the Jev API |

## Common operations

```bash
pnpm infra:up            # start Kafka, Postgres and jev-mock
pnpm infra:topics        # ensure logs.raw / logs.dlq / logs.flags exist
pnpm infra:down          # stop and remove volumes
pnpm db:migrate          # apply Drizzle migrations (DATABASE_URL required)
```

## Dead-letter queue (`logs.dlq`)

Rejected messages carry `reason`, `original-topic` and `original-offset` headers. Reasons:

- `INVALID_ENVELOPE` - not valid JSON or failed the envelope schema.
- `UNSUPPORTED_SCHEMA_VERSION` - `schemaVersion` is a known shape but not version 1.
- `OVERSIZE` - the state exceeded the token budget under `OVERSIZE_POLICY=reject`.

Inspect and replay:

```bash
docker compose -f infra/docker-compose.yml exec kafka \
  /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic logs.dlq --from-beginning --property print.headers=true
```

Fix the producer or raise `JEV_REQUEST_TOKEN_LIMIT` / switch `OVERSIZE_POLICY` to `chunk`
(or `truncate`) before replaying. Replayed messages are idempotent: flags are unique on
`(message_id, rule_id)` and action executions on `(flag_id, action_id)`.

## Jev throttling (429 / 529)

Jev's advertised limits are dynamic. On sustained 429/529 the consumer pauses for a backoff window
and does not commit, so the messages are redelivered rather than lost. Tune `JEV_MAX_RPS` down and
watch `centurion_jev_requests_total{outcome="rate_limited"}` before raising it again.

## Jev authentication failure (401)

Fatal: the consumer stops and `/ready` reports `not_ready` with an `auth_error` check. Rotate
`TYPESAFE_API_KEY`, restart the API, and confirm `/ready` before re-enabling traffic.

## Key rotation

- `TYPESAFE_API_KEY`: rotate in the secret store, restart the API. No data migration needed.
- `SECRETS_ENCRYPTION_KEY`: webhook secrets are encrypted with AES-256-GCM. To rotate, decrypt
  with the old key and re-encrypt with the new one (write a short migration script against the
  `actions` table), or re-enter the affected webhook secrets in the dashboard. Never keep two live
  keys in the app; the process reads exactly one.

## Action failures

Failed action executions retry with exponential backoff up to `ACTION_MAX_ATTEMPTS`, then become
`failed` and are visible on the flag detail page. Rows abandoned by a crashed worker are returned
to the queue on the next start (`recoverStuck`). Re-running a successful action is safe: the handler
is idempotent per `(flag_id, action_id)`.

## Backups

Postgres holds rules, versions, actions, flags, executions and (optionally) short excerpts. Raw log
bodies are not stored. Back up the database with the usual `pg_dump`; Kafka retention is a
transport concern, not a store.
