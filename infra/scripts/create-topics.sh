#!/usr/bin/env bash
# Creates the Centurion Kafka topics. Idempotent.
#
# From the host:   pnpm infra:topics   (docker compose exec kafka bash /scripts/create-topics.sh)
# In compose:      the kafka-init service runs this automatically.
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
PARTITIONS="${KAFKA_TOPIC_PARTITIONS:-1}"
REPLICATION="${KAFKA_TOPIC_REPLICATION:-1}"

if [ -x /opt/kafka/bin/kafka-topics.sh ]; then
  KAFKA_TOPICS_BIN="${KAFKA_TOPICS_BIN:-/opt/kafka/bin/kafka-topics.sh}"
else
  KAFKA_TOPICS_BIN="${KAFKA_TOPICS_BIN:-kafka-topics.sh}"
fi

TOPICS=(logs.raw logs.dlq logs.flags)

echo "Ensuring topics on ${BOOTSTRAP} (partitions=${PARTITIONS}, replication=${REPLICATION})"
for topic in "${TOPICS[@]}"; do
  if "${KAFKA_TOPICS_BIN}" --bootstrap-server "${BOOTSTRAP}" --list | grep -qx "${topic}"; then
    echo "  = ${topic} (exists)"
  else
    "${KAFKA_TOPICS_BIN}" --bootstrap-server "${BOOTSTRAP}" --create --if-not-exists \
      --topic "${topic}" --partitions "${PARTITIONS}" --replication-factor "${REPLICATION}"
    echo "  + ${topic} (created)"
  fi
done

echo 'Topics:'
"${KAFKA_TOPICS_BIN}" --bootstrap-server "${BOOTSTRAP}" --list
