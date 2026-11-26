import type { ActionDto } from '@centurion/contracts';
import { useState } from 'react';

import { isValidAction } from '../api/actions';
import { errorMessage } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
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
import { ActionExecutionStatus } from '../features/actions/ActionExecutionStatus';
import { ActionForm } from '../features/actions/ActionForm';
import { useActions, useDeleteAction } from '../hooks/useActions';

interface DeletableAction {
  id: string;
  name: string;
}

type EditingState = ActionDto | 'new' | null;

export function ActionsPage() {
  const actionsQuery = useActions();
  const deleteAction = useDeleteAction();
  const { toast } = useToast();
  const [editing, setEditing] = useState<EditingState>(null);
  const [pendingDelete, setPendingDelete] = useState<DeletableAction | null>(null);

  const handleDelete = async (action: DeletableAction) => {
    try {
      await deleteAction.mutateAsync(action.id);
      toast({ title: 'Action deleted', variant: 'success' });
      setPendingDelete(null);
    } catch (caught) {
      toast({
        title: 'Could not delete the action',
        description: errorMessage(caught),
        variant: 'error',
      });
    }
  };

  const entries = actionsQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Actions</h1>
          <p className="text-sm text-slate-500">
            What runs when a rule triggers. Webhook secrets are write-only.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>New action</Button>
      </div>

      {actionsQuery.isLoading && <p className="text-sm text-slate-500">Loading actions…</p>}
      {actionsQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load actions: {errorMessage(actionsQuery.error)}
        </p>
      )}

      {actionsQuery.data !== undefined && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Enabled</TableHeaderCell>
              <TableHeaderCell>Secret</TableHeaderCell>
              <TableHeaderCell>Last execution</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => {
              if (isValidAction(entry)) {
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium text-slate-900">{entry.name}</TableCell>
                    <TableCell>
                      <Badge variant={entry.type === 'webhook' ? 'info' : 'neutral'}>
                        {entry.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.enabled ? 'success' : 'neutral'}>
                        {entry.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.type === 'webhook' ? (
                        entry.hasSecret ? (
                          <Badge variant="success">configured</Badge>
                        ) : (
                          <span className="text-xs text-slate-500">not set</span>
                        )
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ActionExecutionStatus actionId={entry.id} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                          onClick={() => setEditing(entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-sm font-medium text-red-600 underline-offset-2 hover:underline"
                          onClick={() => setPendingDelete({ id: entry.id, name: entry.name })}
                        >
                          Delete
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{entry.name}</div>
                    <div className="text-xs text-red-600">{entry.invalidReason}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{entry.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.enabled ? 'success' : 'neutral'}>
                      {entry.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="danger">invalid</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-400">—</span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-sm font-medium text-red-600 underline-offset-2 hover:underline"
                      onClick={() => setPendingDelete({ id: entry.id, name: entry.name })}
                    >
                      Delete
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {actionsQuery.data !== undefined && entries.length === 0 && (
        <p className="text-sm text-slate-500">No actions yet.</p>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New action' : 'Edit action'}
        description={editing !== 'new' && editing !== null ? editing.name : undefined}
      >
        {editing !== null && (
          <ActionForm
            key={editing === 'new' ? 'new' : editing.id}
            initialAction={editing === 'new' ? undefined : editing}
            actionId={editing === 'new' ? undefined : editing.id}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete action"
        description={pendingDelete?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteAction.isPending}
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
          This removes the action. Rules that reference it keep the id and will fail until fixed.
        </p>
      </Dialog>
    </div>
  );
}
