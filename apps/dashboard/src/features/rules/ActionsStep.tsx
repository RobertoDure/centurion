import type { ActionDto, UncertainPolicy } from '@centurion/contracts';

import { Badge } from '../../components/ui/Badge';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';

export interface ActionsStepProps {
  actionIds: string[];
  onChange: (actionIds: string[]) => void;
  actions: ActionDto[];
  uncertainPolicy: UncertainPolicy;
  onUncertainPolicyChange: (policy: UncertainPolicy) => void;
}

const POLICY_OPTIONS = [
  { value: 'ignore', label: 'ignore (drop uncertain hits)' },
  { value: 'review', label: 'review (persist a flag, do not run actions)' },
];

export function ActionsStep({
  actionIds,
  onChange,
  actions,
  uncertainPolicy,
  onUncertainPolicyChange,
}: ActionsStepProps) {
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Actions to run when the rule triggers</legend>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No actions defined yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {actions.map((action) => (
              <Checkbox
                key={action.id}
                label={action.name}
                description={`${action.type} · ${action.enabled ? 'enabled' : 'disabled'}`}
                checked={actionIds.includes(action.id)}
                disabled={!action.enabled}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...actionIds, action.id]
                    : actionIds.filter((id) => id !== action.id);
                  onChange(next);
                }}
              />
            ))}
          </div>
        )}
      </fieldset>
      <Select
        label="When confidence is below the minimum"
        value={uncertainPolicy}
        onChange={(event) => {
          onUncertainPolicyChange(event.target.value === 'review' ? 'review' : 'ignore');
        }}
        options={POLICY_OPTIONS}
      />
      {actionIds.length > 0 && (
        <p className="text-xs text-slate-500">
          {actionIds.length} action(s) selected <Badge variant="info">runs on TRIGGERED only</Badge>
        </p>
      )}
    </div>
  );
}
