import type { ActionDefinition, Rule } from '@centurion/contracts';

export type RuleListEntry =
  | { kind: 'valid'; rule: Rule }
  | {
      kind: 'invalid';
      id: string;
      name: string;
      enabled: boolean;
      version: number;
      reason: string;
    };

export type RuleVersionEntry =
  | { version: number; createdAt: string; rule: Rule }
  | { version: number; createdAt: string; reason: string };

/** Encrypt/decrypt the webhook secret inside an action config. */
export interface ActionConfigCodec {
  encode(config: Record<string, unknown>): Record<string, unknown>;
  decode(config: Record<string, unknown>): Record<string, unknown>;
}

export const identityActionConfigCodec: ActionConfigCodec = {
  encode: (config) => config,
  decode: (config) => config,
};

export type ActionEntry =
  | { kind: 'valid'; action: ActionDefinition; hasSecret: boolean }
  | { kind: 'invalid'; id: string; name: string; enabled: boolean; type: string; reason: string };
