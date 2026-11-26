import type {
  ConsumerStatusData,
  FlagCreatedData,
  LogProcessedData,
  SseEvent,
} from '@centurion/contracts';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { useSseStream } from './useSseStream';

export interface LiveEventsValue {
  logs: LogProcessedData[];
  flags: FlagCreatedData[];
  consumerStatus: ConsumerStatusData | null;
  connected: boolean;
  lastEventId: string | undefined;
  error: string | undefined;
  reconnectAttempts: number;
}

const EMPTY: LiveEventsValue = {
  logs: [],
  flags: [],
  consumerStatus: null,
  connected: false,
  lastEventId: undefined,
  error: undefined,
  reconnectAttempts: 0,
};

const LiveEventsContext = createContext<LiveEventsValue>(EMPTY);

export interface LiveEventsProviderProps {
  children: ReactNode;
  enabled?: boolean;
  url?: string;
  fetchImpl?: typeof fetch;
  reconnectDelayMs?: number;
  maxLogs?: number;
}

function deriveEvents(events: SseEvent[], maxLogs: number): Omit<LiveEventsValue, 'connected' | 'lastEventId' | 'error' | 'reconnectAttempts'> {
  const logs: LogProcessedData[] = [];
  const flags: FlagCreatedData[] = [];
  let consumerStatus: ConsumerStatusData | null = null;
  for (const event of events) {
    switch (event.type) {
      case 'log.processed':
        logs.push(event.data);
        break;
      case 'flag.created':
        flags.push(event.data);
        break;
      case 'consumer.status':
        consumerStatus = event.data;
        break;
    }
  }
  return { logs: logs.slice(-maxLogs), flags: flags.slice(-maxLogs), consumerStatus };
}

/** App-level SSE subscription shared by the live feed and system status pages. */
export function LiveEventsProvider({
  children,
  enabled = true,
  url,
  fetchImpl,
  reconnectDelayMs,
  maxLogs = 500,
}: LiveEventsProviderProps) {
  const { events, connected, lastEventId, error, reconnectAttempts } = useSseStream({
    enabled,
    ...(url === undefined ? {} : { url }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(reconnectDelayMs === undefined ? {} : { reconnectDelayMs }),
    maxEvents: maxLogs * 2,
  });

  const value = useMemo<LiveEventsValue>(
    () => ({
      ...deriveEvents(events, maxLogs),
      connected,
      lastEventId,
      error,
      reconnectAttempts,
    }),
    [events, maxLogs, connected, lastEventId, error, reconnectAttempts],
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents(): LiveEventsValue {
  return useContext(LiveEventsContext);
}
