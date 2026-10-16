import {
  actionContentSchema,
  type ActionContent,
  type ActionPayload,
  type ActionType,
  type KafkaTopicConfig,
  type WebhookConfig,
} from '@centurion/contracts';

import type { ActionHandler, ActionHandlerContext, ActionResult } from './types';

export class ActionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionConfigError';
  }
}

type Dispatch = (
  payload: ActionPayload,
  config: unknown,
  context: ActionHandlerContext,
) => Promise<ActionResult>;

/**
 * Registry-based dispatch (PLAN.md 5.5): new action types are added by
 * registering a handler, not by editing a switch.
 */
export class ActionRegistry {
  private readonly dispatch = new Map<ActionType, Dispatch>();

  register<TConfig>(handler: ActionHandler<TConfig>): this {
    // The config is validated by actionContentSchema in execute(), so the cast
    // to the handler's config type is sound.
    this.dispatch.set(handler.type, (payload, config, context) =>
      handler.execute(payload, config as TConfig, context),
    );
    return this;
  }

  has(type: ActionType): boolean {
    return this.dispatch.has(type);
  }

  types(): ActionType[] {
    return [...this.dispatch.keys()];
  }

  async execute(
    action: ActionContent,
    payload: ActionPayload,
    context: ActionHandlerContext,
  ): Promise<ActionResult> {
    const parsed = actionContentSchema.safeParse(action);
    if (!parsed.success) {
      throw new ActionConfigError(
        `invalid ${action.type} action config: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const handler = this.dispatch.get(parsed.data.type);
    if (handler === undefined) {
      throw new ActionConfigError(`no handler registered for action type "${parsed.data.type}"`);
    }
    return handler(payload, parsed.data.config, context);
  }
}

export function createDefaultActionRegistry(options: {
  webhook: ActionHandler<WebhookConfig>;
  kafkaTopic: ActionHandler<KafkaTopicConfig>;
}): ActionRegistry {
  return new ActionRegistry().register(options.webhook).register(options.kafkaTopic);
}
