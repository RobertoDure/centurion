import type { ActionPayload, KafkaTopicConfig } from '@centurion/contracts';

import type { ActionHandler, ActionResult } from './types';

export interface KafkaRecord {
  topic: string;
  key: string;
  value: string;
  headers?: Record<string, string>;
}

export interface KafkaProducerLike {
  send(record: KafkaRecord): Promise<void>;
}

export interface KafkaTopicHandlerDeps {
  producer: KafkaProducerLike;
  /** Used when the action config does not pin a topic. */
  defaultTopic?: string;
}

/** Publishes the action payload to a Kafka topic, keyed by rule id (PLAN.md 8.1). */
export function createKafkaTopicHandler(
  deps: KafkaTopicHandlerDeps,
): ActionHandler<KafkaTopicConfig> {
  return {
    type: 'kafka_topic',
    async execute(payload: ActionPayload, config: KafkaTopicConfig): Promise<ActionResult> {
      const topic = config.topic.length > 0 ? config.topic : deps.defaultTopic;
      if (topic === undefined || topic.length === 0) {
        throw new Error('kafka_topic action has no topic and no default topic is configured');
      }
      await deps.producer.send({
        topic,
        key: payload.rule.id,
        value: JSON.stringify(payload),
        headers: { 'content-type': 'application/json', 'x-centurion-flag-id': payload.flagId },
      });
      return { detail: `published to ${topic}` };
    },
  };
}
