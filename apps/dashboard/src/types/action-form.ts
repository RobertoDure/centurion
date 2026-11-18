import type { ActionType } from '@centurion/contracts';

export interface WebhookConfigInput {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface KafkaTopicConfigInput {
  topic: string;
  brokers?: string[];
}

export interface WebhookActionFormValues {
  type: Extract<ActionType, 'webhook'>;
  name: string;
  enabled: boolean;
  config: WebhookConfigInput;
}

export interface KafkaActionFormValues {
  type: Extract<ActionType, 'kafka_topic'>;
  name: string;
  enabled: boolean;
  config: KafkaTopicConfigInput;
}

export type ActionFormValues = WebhookActionFormValues | KafkaActionFormValues;
