import { logLevelSchema } from '@centurion/contracts';
import type { RuleScope } from '@centurion/contracts';

import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';

export interface ScopeStepProps {
  value: RuleScope;
  onChange: (scope: RuleScope) => void;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function ScopeStep({ value, onChange }: ScopeStepProps) {
  return (
    <div className="space-y-4">
      <Input
        label="Sources"
        value={(value.sources ?? []).join(', ')}
        onChange={(event) => onChange({ ...value, sources: splitList(event.target.value) })}
        hint="Comma-separated source ids. Leave blank to match every source."
        placeholder="checkout-service, support-bot"
      />
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Levels</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {logLevelSchema.options.map((level) => (
            <Checkbox
              key={level}
              label={level}
              checked={(value.levels ?? []).includes(level)}
              onChange={(event) => {
                const current = value.levels ?? [];
                const next = event.target.checked
                  ? [...current, level]
                  : current.filter((entry) => entry !== level);
                onChange({ ...value, levels: next });
              }}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Selecting no level matches every level, including logs without one.
        </p>
      </fieldset>
    </div>
  );
}
