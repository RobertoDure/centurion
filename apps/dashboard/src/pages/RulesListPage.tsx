import type { RuleDto } from '@centurion/contracts';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { errorMessage } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { Dialog } from '../components/ui/Dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';
import { VersionHistoryDrawer } from '../features/rules/VersionHistoryDrawer';
import { useDeleteRule, useRules, useToggleRule } from '../hooks/useRules';

const NEW_RULE_LINK =
  'inline-flex items-center justify-center rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700';

function scopeSummary(rule: RuleDto): string {
  const sources = rule.scope.sources ?? [];
  const levels = rule.scope.levels ?? [];
  const sourceLabel = sources.length > 0 ? sources.join(', ') : 'any source';
  const levelLabel = levels.length > 0 ? levels.join(', ') : 'any level';
  return `${sourceLabel} · ${levelLabel}`;
}

export function RulesListPage() {
  const rulesQuery = useRules();
  const toggleRule = useToggleRule();
  const deleteRule = useDeleteRule();
  const { toast } = useToast();
  const [historyRule, setHistoryRule] = useState<RuleDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RuleDto | null>(null);

  const handleToggle = async (rule: RuleDto, enabled: boolean) => {
    try {
      await toggleRule.mutateAsync({ id: rule.id, enabled });
      toast({ title: enabled ? 'Rule enabled' : 'Rule disabled', variant: 'success' });
    } catch (caught) {
      toast({
        title: 'Could not update the rule',
        description: errorMessage(caught),
        variant: 'error',
      });
    }
  };

  const handleDelete = async (rule: RuleDto) => {
    try {
      await deleteRule.mutateAsync(rule.id);
      toast({ title: 'Rule deleted', variant: 'success' });
      setPendingDelete(null);
    } catch (caught) {
      toast({
        title: 'Could not delete the rule',
        description: errorMessage(caught),
        variant: 'error',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Rules</h1>
          <p className="text-sm text-slate-500">
            Deterministic pre-filter by scope, then one Jev question per rule.
          </p>
        </div>
        <Link to="/rules/new" className={NEW_RULE_LINK}>
          New rule
        </Link>
      </div>

      {rulesQuery.isLoading && <p className="text-sm text-slate-500">Loading rules…</p>}
      {rulesQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load rules: {errorMessage(rulesQuery.error)}
        </p>
      )}

      {rulesQuery.data !== undefined && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Primitive</TableHeaderCell>
              <TableHeaderCell>Scope</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Enabled</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rulesQuery.data.items.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  <div className="font-medium text-slate-900">{rule.name}</div>
                  {rule.description !== undefined && (
                    <div className="text-xs text-slate-500">{rule.description}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="info">{rule.question.type}</Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-600">{scopeSummary(rule)}</TableCell>
                <TableCell className="tabular-nums">v{rule.version}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {rule.invalid && (
                      <Badge variant="danger" title={rule.invalidReason}>
                        invalid
                      </Badge>
                    )}
                    {!rule.enabled && rule.disabledReason !== undefined && (
                      <Badge variant="warning" title={rule.disabledReason}>
                        auto-disabled
                      </Badge>
                    )}
                    {!rule.enabled && rule.disabledReason === undefined && (
                      <Badge variant="neutral">disabled</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Checkbox
                    label={rule.enabled ? 'enabled' : 'disabled'}
                    aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                    checked={rule.enabled}
                    disabled={toggleRule.isPending}
                    onChange={(event) => void handleToggle(rule, event.target.checked)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/rules/${rule.id}/edit`}
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      onClick={() => setHistoryRule(rule)}
                    >
                      Versions
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-red-600 underline-offset-2 hover:underline"
                      onClick={() => setPendingDelete(rule)}
                    >
                      Delete
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rulesQuery.data !== undefined && rulesQuery.data.items.length === 0 && (
        <p className="text-sm text-slate-500">No rules yet.</p>
      )}

      <VersionHistoryDrawer rule={historyRule} onClose={() => setHistoryRule(null)} />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete rule"
        description={pendingDelete?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteRule.isPending}
              onClick={() => {
                if (pendingDelete !== null) void handleDelete(pendingDelete);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This removes the rule and its version history. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
