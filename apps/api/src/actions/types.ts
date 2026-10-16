import type { ActionPayload, ActionType } from '@centurion/contracts';

export interface ActionHandlerContext {
  flagId: string;
  /** 1-based attempt number. */
  attempt: number;
}

export interface ActionResult {
  detail?: string;
}

export interface ActionHandler<TConfig> {
  readonly type: ActionType;
  execute(
    payload: ActionPayload,
    config: TConfig,
    context: ActionHandlerContext,
  ): Promise<ActionResult>;
}
