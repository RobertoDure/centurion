import type { ActionExecutionStatus } from '@centurion/contracts';

import type { FlagEntry } from '../../api/flags';
import { AnswerView } from '../../components/answer/AnswerView';
import { Badge } from '../../components/ui/Badge';
import type { BadgeVariant } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { useActionExecutions, useActions } from '../../hooks/useActions';
import { useRule } from '../../hooks/useRules';
import { formatDateTime } from '../../lib/format';

const EXECUTION_VARIANTS: Record<ActionExecutionStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

export interface FlagDetailsDrawerProps {
  flag: FlagEntry | null;
  onClose: () => void;
}

export function FlagDetailsDrawer({ flag, onClose }: FlagDetailsDrawerProps) {
  const ruleId = flag !== null && !('invalid' in flag) ? flag.ruleId : undefined;
  const rule = useRule(ruleId);
  const actions = useActions();
  const actionEntries = actions.data?.items ?? [];

  return (
    <Drawer
      open={flag !== null}
      onClose={onClose}
      title="Flag details"
      description={flag !== null && !('invalid' in flag) ? flag.messageId : undefined}
    >
      {flag === null ? null : 'invalid' in flag ? (
        <div className="space-y-2">
          <Badge variant="danger">invalid</Badge>
          <p className="text-sm text-slate-700">{flag.invalidReason}</p>
          <p className="text-xs text-slate-500">id {flag.id}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="Outcome">
              <Badge variant={flag.outcome === 'triggered' ? 'danger' : 'warning'}>
                {flag.outcome}
              </Badge>
            </Detail>
            <Detail label="Rule version">v{flag.ruleVersion}</Detail>
            <Detail label="Source">{flag.sourceId}</Detail>
            <Detail label="Created">{formatDateTime(flag.createdAt)}</Detail>
            <Detail label="Message">{flag.messageId}</Detail>
            <Detail label="Flag id">{flag.id}</Detail>
          </dl>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Answer</h3>
            <AnswerView answer={flag.answer} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Action executions</h3>
            {rule.data === undefined ? (
              <p className="text-xs text-slate-500">Loading rule actions…</p>
            ) : rule.data.actionIds.length === 0 ? (
              <p className="text-xs text-slate-500">This rule has no actions.</p>
            ) : (
              <div>
                {rule.data.actionIds.map((actionId) => (
                  <FlagExecutionRow
                    key={actionId}
                    actionId={actionId}
                    flagId={flag.id}
                    name={actionEntries.find((entry) => entry.id === actionId)?.name ?? actionId}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}

function FlagExecutionRow({
  actionId,
  flagId,
  name,
}: {
  actionId: string;
  flagId: string;
  name: string;
}) {
  const executions = useActionExecutions(actionId);
  const match = executions.data?.find((execution) => execution.flagId === flagId);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-slate-800">{name}</div>
        <div className="truncate text-xs text-slate-500">{actionId}</div>
      </div>
      {executions.isLoading ? (
        <span className="text-xs text-slate-400">…</span>
      ) : match === undefined ? (
        <span className="text-xs text-slate-400">no execution recorded</span>
      ) : (
        <span className="inline-flex items-center gap-2" title={match.lastError}>
          <Badge variant={EXECUTION_VARIANTS[match.status]}>{match.status}</Badge>
          <span className="text-xs text-slate-500">
            {match.attempts} attempt{match.attempts === 1 ? '' : 's'}
          </span>
        </span>
      )}
    </div>
  );
}
