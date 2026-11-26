import type { LogProcessedData } from '@centurion/contracts';

import { Badge } from '../components/ui/Badge';
import type { BadgeVariant } from '../components/ui/Badge';
import { VirtualList } from '../components/VirtualList';
import { useLiveEvents } from '../hooks/useLiveEvents';

const STATUS_VARIANTS: Record<LogProcessedData['status'], BadgeVariant> = {
  clean: 'success',
  flagged: 'danger',
  uncertain: 'warning',
  error: 'danger',
  partial: 'info',
};

const ROW_HEIGHT = 52;
const MAX_ROWS = 500;

export function LiveFeedPage() {
  const { logs, flags, connected, lastEventId, error, reconnectAttempts } = useLiveEvents();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Live feed</h1>
          <p className="text-sm text-slate-500">
            Streaming GET /api/v1/stream (log.processed, flag.created, consumer.status).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={connected ? 'success' : 'neutral'}>
            {connected ? 'connected' : 'disconnected'}
          </Badge>
          {reconnectAttempts > 0 && (
            <span className="text-amber-600">reconnecting ({reconnectAttempts})</span>
          )}
          {lastEventId !== undefined && (
            <span className="text-slate-500">Last-Event-ID {lastEventId}</span>
          )}
        </div>
      </div>

      {error !== undefined && (
        <p role="alert" className="text-sm text-red-600">
          Stream error: {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Logs processed</h2>
            <span className="text-xs text-slate-500">
              {logs.length} / {MAX_ROWS}
            </span>
          </div>
          <VirtualList
            items={logs}
            rowHeight={ROW_HEIGHT}
            height={480}
            ariaLabel="Live logs"
            getKey={(log, index) => `${log.messageId}-${index}`}
            renderRow={(log) => <LogRow log={log} />}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Recent flags</h2>
            <span className="text-xs text-slate-500">{flags.length}</span>
          </div>
          <div
            className="overflow-y-auto rounded-lg border border-slate-200 bg-white"
            style={{ height: 480 }}
          >
            {flags.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">No flags yet.</p>
            ) : (
              <ul data-testid="live-flags" className="divide-y divide-slate-100">
                {[...flags]
                  .reverse()
                  .slice(0, 100)
                  .map((flag) => (
                    <li key={flag.id} className="space-y-1 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={flag.outcome === 'triggered' ? 'danger' : 'warning'}>
                          {flag.outcome}
                        </Badge>
                        <span className="text-xs text-slate-500">{flag.sourceId}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {flag.answer.type} · rule {flag.ruleId.slice(0, 8)} · v{flag.ruleVersion}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogProcessedData }) {
  return (
    <>
      <Badge variant={STATUS_VARIANTS[log.status]} className="w-20 justify-center">
        {log.status}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-slate-800">{log.messageId}</div>
        <div className="truncate text-xs text-slate-500">
          {log.sourceId}
          {log.level === undefined ? '' : ` · ${log.level}`}
          {log.model === undefined ? '' : ` · ${log.model}`}
        </div>
      </div>
      <div className="whitespace-nowrap text-xs text-slate-500">
        {log.flagCount > 0 ? `${log.flagCount} flag` : ''}
        {log.partial ? ' partial' : ''}
      </div>
    </>
  );
}
