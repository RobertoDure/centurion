import type { ActionExecution } from '@centurion/contracts';

import { Badge } from '../../components/ui/Badge';
import type { BadgeVariant } from '../../components/ui/Badge';
import { useActionExecutions } from '../../hooks/useActions';

const STATUS_VARIANTS: Record<ActionExecution['status'], BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

export function ActionExecutionStatus({ actionId }: { actionId: string }) {
  const executions = useActionExecutions(actionId);

  if (executions.isLoading) {
    return <span className="text-xs text-slate-400">loading…</span>;
  }
  const latest = executions.data?.[executions.data.length - 1];
  if (latest === undefined) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" title={latest.lastError}>
      <Badge variant={STATUS_VARIANTS[latest.status]}>{latest.status}</Badge>
      <span className="text-xs text-slate-500">
        {latest.attempts} attempt{latest.attempts === 1 ? '' : 's'}
      </span>
    </span>
  );
}
