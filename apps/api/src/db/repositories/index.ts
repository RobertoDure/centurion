import type { Database } from '../client';
import { ActionsRepository } from './actions';
import { ActionExecutionsRepository } from './action-executions';
import { EvaluationsRepository } from './evaluations';
import { FlagsRepository } from './flags';
import { OutcomeRepository } from './recording';
import { RulesRepository } from './rules';
import type { ActionConfigCodec } from './types';

export * from './actions';
export * from './action-executions';
export * from './evaluations';
export * from './flags';
export * from './recording';
export * from './rules';
export * from './types';

export interface Repositories {
  rules: RulesRepository;
  actions: ActionsRepository;
  flags: FlagsRepository;
  evaluations: EvaluationsRepository;
  executions: ActionExecutionsRepository;
  outcomes: OutcomeRepository;
}

export function createRepositories(db: Database, codec?: ActionConfigCodec): Repositories {
  const actions = new ActionsRepository(db, codec);
  return {
    rules: new RulesRepository(db),
    actions,
    flags: new FlagsRepository(db),
    evaluations: new EvaluationsRepository(db),
    executions: new ActionExecutionsRepository(db, actions),
    outcomes: new OutcomeRepository(db),
  };
}
