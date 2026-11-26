import type { ConsumerStatus } from '@centurion/contracts';
import type { ReactNode } from 'react';

import { Badge } from '../components/ui/Badge';
import type { BadgeVariant } from '../components/ui/Badge';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { formatDateTime, formatPercent } from '../lib/format';

const STATUS_VARIANTS: Record<ConsumerStatus, BadgeVariant> = {
  running: 'success',
  paused: 'warning',
  stopped: 'neutral',
  degraded: 'warning',
  error: 'danger',
};

export function SystemStatusPage() {
  const { consumerStatus, connected } = useLiveEvents();
  const status = useSystemStatus();
  const lag = consumerStatus?.lag ?? status.lag;
  const jevAuth = status.ready?.checks.find((check) => check.name === 'jev_auth');
  const authProblem = jevAuth !== undefined && !jevAuth.ok;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">System status</h1>
        <p className="text-sm text-slate-500">
          Consumer status from the SSE stream, plus /ready and /metrics polling.
        </p>
      </div>

      {authProblem && (
        <div
          role="alert"
          data-testid="auth-problem"
          className="rounded-lg border border-red-300 bg-red-50 p-4"
        >
          <p className="text-sm font-semibold text-red-900">Jev authentication problem</p>
          <p className="text-sm text-red-800">
            {jevAuth?.detail ?? 'The API key is missing or was rejected.'}
          </p>
        </div>
      )}

      {status.ready?.status === 'not_ready' && (
        <div
          role="alert"
          data-testid="not-ready"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">The API reports not_ready</p>
        </div>
      )}

      {status.healthError !== undefined && (
        <p role="alert" className="text-sm text-red-600">
          Health check failed: {status.healthError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Consumer status">
          {consumerStatus !== null ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="consumer-status">
              <Badge variant={STATUS_VARIANTS[consumerStatus.status]}>{consumerStatus.status}</Badge>
              <span className="text-xs text-slate-500">{formatDateTime(consumerStatus.at)}</span>
            </div>
          ) : (
            <span className="text-sm text-slate-500">
              {connected ? 'waiting for an event…' : 'not connected'}
            </span>
          )}
          {consumerStatus?.detail !== undefined && (
            <p className="mt-1 text-xs text-slate-500">{consumerStatus.detail}</p>
          )}
        </Stat>

        <Stat label="Consumer lag">
          <span data-testid="consumer-lag" className="text-2xl font-semibold tabular-nums">
            {lag ?? '—'}
          </span>
        </Stat>

        <Stat label="Jev error rate">
          <span data-testid="jev-error-rate" className="text-2xl font-semibold tabular-nums">
            {status.jevErrorRate === undefined ? '—' : formatPercent(status.jevErrorRate, 2)}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {status.jevThrottled} throttled / {status.jevRequests} requests
          </p>
        </Stat>

        <Stat label="DLQ messages">
          <span data-testid="dlq-total" className="text-2xl font-semibold tabular-nums">
            {status.dlqTotal}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {status.uncertainIgnored} uncertain ignored
          </p>
        </Stat>
      </div>

      {status.metricsError !== undefined && (
        <p role="alert" className="text-sm text-red-600">
          Metrics unavailable: {status.metricsError}
        </p>
      )}
      {status.readyError !== undefined && (
        <p role="alert" className="text-sm text-red-600">
          Readiness unavailable: {status.readyError}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Readiness checks</h2>
        {status.ready === undefined ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {status.ready.checks.map((check) => (
              <li
                key={check.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="text-sm text-slate-700">{check.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={check.ok ? 'success' : 'danger'}>
                    {check.ok ? 'ok' : 'failed'}
                  </Badge>
                  {check.detail !== undefined && (
                    <span className="text-xs text-slate-500">{check.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
