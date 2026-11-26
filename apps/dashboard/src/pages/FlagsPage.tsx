import { useState } from 'react';

import { errorMessage } from '../api/client';
import type { FlagEntry, FlagListQuery } from '../api/flags';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../components/ui/Table';
import { FlagDetailsDrawer } from '../features/flags/FlagDetailsDrawer';
import { useFlags } from '../hooks/useFlags';
import { useRules } from '../hooks/useRules';
import { formatDateTime } from '../lib/format';

const PAGE_SIZE = 25;

interface FilterDraft {
  ruleId: string;
  sourceId: string;
  outcome: '' | 'triggered' | 'uncertain';
  from: string;
  to: string;
}

const EMPTY_FILTERS: FilterDraft = {
  ruleId: '',
  sourceId: '',
  outcome: '',
  from: '',
  to: '',
};

function toQuery(filters: FilterDraft, offset: number): FlagListQuery {
  return {
    ...(filters.ruleId === '' ? {} : { ruleId: filters.ruleId }),
    ...(filters.sourceId === '' ? {} : { sourceId: filters.sourceId }),
    ...(filters.outcome === '' ? {} : { outcome: filters.outcome }),
    ...(filters.from === '' ? {} : { from: new Date(filters.from).toISOString() }),
    ...(filters.to === '' ? {} : { to: new Date(filters.to).toISOString() }),
    limit: PAGE_SIZE,
    offset,
  };
}

export function FlagsPage() {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterDraft>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<FlagEntry | null>(null);
  const rulesQuery = useRules();
  const flagsQuery = useFlags(toQuery(applied, offset));
  const rules = rulesQuery.data?.items ?? [];
  const items = flagsQuery.data?.items ?? [];
  const hasMore = items.length === PAGE_SIZE;

  const ruleName = (ruleId: string): string =>
    rules.find((rule) => rule.id === ruleId)?.name ?? ruleId.slice(0, 8);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Flags</h1>
        <p className="text-sm text-slate-500">
          GET /api/v1/flags with rule, source, outcome and time filters.
        </p>
      </div>

      <form
        aria-label="Flag filters"
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
          setOffset(0);
        }}
      >
        <Select
          label="Rule"
          value={draft.ruleId}
          options={[
            { value: '', label: 'All rules' },
            ...rules.map((rule) => ({ value: rule.id, label: rule.name })),
          ]}
          onChange={(event) => setDraft({ ...draft, ruleId: event.target.value })}
        />
        <Input
          label="Source"
          placeholder="checkout-service"
          value={draft.sourceId}
          onChange={(event) => setDraft({ ...draft, sourceId: event.target.value })}
        />
        <Select
          label="Outcome"
          value={draft.outcome}
          options={[
            { value: '', label: 'All outcomes' },
            { value: 'triggered', label: 'triggered' },
            { value: 'uncertain', label: 'uncertain' },
          ]}
          onChange={(event) =>
            setDraft({
              ...draft,
              outcome:
                event.target.value === 'triggered' || event.target.value === 'uncertain'
                  ? event.target.value
                  : '',
            })
          }
        />
        <Input
          label="From"
          type="datetime-local"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        <Input
          label="To"
          type="datetime-local"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        <div className="flex items-end gap-2">
          <Button type="submit">Apply filters</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setOffset(0);
            }}
          >
            Reset
          </Button>
        </div>
      </form>

      {flagsQuery.isLoading && <p className="text-sm text-slate-500">Loading flags…</p>}
      {flagsQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load flags: {errorMessage(flagsQuery.error)}
        </p>
      )}

      {flagsQuery.data !== undefined && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell>Rule</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Outcome</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Message</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((entry) => {
              if ('invalid' in entry) {
                return (
                  <TableRow key={entry.id}>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <Badge variant="danger" title={entry.invalidReason}>
                        invalid
                      </Badge>
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell className="text-xs text-red-600">{entry.invalidReason}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                        onClick={() => setSelected(entry)}
                      >
                        Details
                      </button>
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={entry.id}>
                  <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>{ruleName(entry.ruleId)}</TableCell>
                  <TableCell>{entry.sourceId}</TableCell>
                  <TableCell>
                    <Badge variant={entry.outcome === 'triggered' ? 'danger' : 'warning'}>
                      {entry.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">v{entry.ruleVersion}</TableCell>
                  <TableCell className="text-xs">{entry.messageId}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                      onClick={() => setSelected(entry)}
                    >
                      Details
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {flagsQuery.data !== undefined && items.length === 0 && (
        <p className="text-sm text-slate-500">No flags match these filters.</p>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Showing {items.length === 0 ? 0 : offset + 1}–{offset + items.length}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasMore}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <FlagDetailsDrawer flag={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
