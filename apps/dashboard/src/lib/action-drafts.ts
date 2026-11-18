import type { ActionDto } from '@centurion/contracts';

import type {
  ActionFormValues,
  KafkaTopicConfigInput,
  WebhookConfigInput,
} from '../types/action-form';

export function isWebhookConfig(
  config: ActionFormValues['config'],
): config is WebhookConfigInput {
  return 'url' in config;
}

export function isKafkaConfig(
  config: ActionFormValues['config'],
): config is KafkaTopicConfigInput {
  return 'topic' in config;
}

export function defaultWebhookConfig(): WebhookConfigInput {
  return { url: '', timeoutMs: 10_000 };
}

export function defaultKafkaConfig(): KafkaTopicConfigInput {
  return { topic: '' };
}

export function actionToFormValues(action: ActionDto): ActionFormValues {
  if (action.type === 'webhook') {
    return {
      type: 'webhook',
      name: action.name,
      enabled: action.enabled,
      config: {
        url: action.config.url,
        timeoutMs: action.config.timeoutMs,
        ...(action.config.headers !== undefined ? { headers: action.config.headers } : {}),
      },
    };
  }
  return {
    type: 'kafka_topic',
    name: action.name,
    enabled: action.enabled,
    config: {
      topic: action.config.topic,
      ...(action.config.brokers !== undefined ? { brokers: action.config.brokers } : {}),
    },
  };
}

export function headersToText(headers: Record<string, string> | undefined): string {
  if (headers === undefined) return '';
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key !== '') headers[key] = value;
  }
  return headers;
}

export function brokersToText(brokers: string[] | undefined): string {
  return (brokers ?? []).join('\n');
}

export function textToBrokers(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}
