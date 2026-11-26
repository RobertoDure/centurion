import type { ReadyResponse } from '@centurion/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { errorMessage } from '../api/client';
import { systemApi } from '../api/system';
import { gaugeValue, parsePrometheus, sumSamples, type PromSample } from '../lib/metrics';

export const systemKeys = {
  ready: ['system', 'ready'] as const,
  metrics: ['system', 'metrics'] as const,
  health: ['system', 'health'] as const,
};

export interface SystemStatus {
  ready: ReadyResponse | undefined;
  readyError: string | undefined;
  samples: PromSample[];
  metricsError: string | undefined;
  healthOk: boolean;
  healthError: string | undefined;
  lag: number | undefined;
  dlqTotal: number;
  jevRequests: number;
  jevThrottled: number;
  jevErrorRate: number | undefined;
  uncertainIgnored: number;
}

export function useSystemStatus(): SystemStatus {
  const ready = useQuery({
    queryKey: systemKeys.ready,
    queryFn: ({ signal }) => systemApi.ready({ signal }),
    refetchInterval: 10_000,
    retry: false,
  });
  const metrics = useQuery({
    queryKey: systemKeys.metrics,
    queryFn: ({ signal }) => systemApi.metrics({ signal }),
    refetchInterval: 10_000,
    retry: false,
  });
  const health = useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => systemApi.health({ signal }),
    refetchInterval: 30_000,
    retry: false,
  });

  return useMemo<SystemStatus>(() => {
    const samples = metrics.data === undefined ? [] : parsePrometheus(metrics.data);
    const jevRequests = sumSamples(samples, 'centurion_jev_request_duration_seconds_count');
    const jevThrottled = sumSamples(samples, 'centurion_jev_throttled_total');
    return {
      ready: ready.data,
      readyError: ready.isError ? errorMessage(ready.error) : undefined,
      samples,
      metricsError: metrics.isError ? errorMessage(metrics.error) : undefined,
      healthOk: health.data?.status === 'ok',
      healthError: health.isError ? errorMessage(health.error) : undefined,
      lag: gaugeValue(samples, 'centurion_consumer_lag'),
      dlqTotal: sumSamples(samples, 'centurion_dlq_total'),
      jevRequests,
      jevThrottled,
      jevErrorRate: jevRequests > 0 ? jevThrottled / jevRequests : undefined,
      uncertainIgnored: sumSamples(samples, 'centurion_uncertain_ignored_total'),
    };
  }, [ready.data, ready.isError, ready.error, metrics.data, metrics.isError, metrics.error, health.data, health.isError, health.error]);
}
