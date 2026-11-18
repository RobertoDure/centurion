import { useParams } from 'react-router-dom';

import { errorMessage } from '../api/client';
import { RuleEditorForm } from '../features/rules/RuleEditorForm';
import { useRule } from '../hooks/useRules';
import { ruleToFormValues } from '../lib/rule-drafts';

export function RuleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const ruleQuery = useRule(id);
  const isEdit = id !== undefined;
  const rule = ruleQuery.data;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">{isEdit ? 'Edit rule' : 'New rule'}</h1>
      {isEdit && ruleQuery.isLoading && <p className="text-sm text-slate-500">Loading rule…</p>}
      {isEdit && ruleQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load rule: {errorMessage(ruleQuery.error)}
        </p>
      )}
      {(!isEdit || rule !== undefined) && (
        <RuleEditorForm
          key={id ?? 'new'}
          ruleId={id}
          initialValues={rule !== undefined ? ruleToFormValues(rule) : undefined}
        />
      )}
    </div>
  );
}
