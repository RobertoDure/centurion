import { createHmac } from 'node:crypto';

import type { ActionPayload, WebhookConfig } from '@centurion/contracts';

import { assertUrlAllowed } from './ssrf';
import type { ActionHandler, ActionResult } from './types';

export const SIGNATURE_HEADER = 'x-centurion-signature';

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export interface WebhookHandlerDeps {
  fetch?: typeof globalThis.fetch;
  /** Defaults to the SSRF guard; injectable for tests. */
  guard?: (url: string) => Promise<URL>;
}

/**
 * Delivers the action payload as JSON with an optional HMAC-SHA256 signature.
 * The SSRF guard runs before every request, so a misconfigured rule cannot be
 * used to probe private networks.
 */
export function createWebhookHandler(deps: WebhookHandlerDeps = {}): ActionHandler<WebhookConfig> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const guard = deps.guard ?? ((url: string) => assertUrlAllowed(url));
  return {
    type: 'webhook',
    async execute(payload: ActionPayload, config: WebhookConfig): Promise<ActionResult> {
      const url = await guard(config.url);
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(config.headers ?? {}),
      };
      if (config.secret !== undefined && config.secret.length > 0) {
        headers[SIGNATURE_HEADER] = signWebhookPayload(config.secret, body);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`webhook responded with HTTP ${response.status}`);
        }
        return { detail: `webhook HTTP ${response.status}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
