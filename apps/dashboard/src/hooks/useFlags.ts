import { useQuery } from '@tanstack/react-query';

import { flagsApi, type FlagListQuery } from '../api/flags';

export const flagKeys = {
  all: ['flags'] as const,
  list: (query: FlagListQuery) => [...flagKeys.all, 'list', query] as const,
};

export function useFlags(query: FlagListQuery = {}) {
  return useQuery({
    queryKey: flagKeys.list(query),
    queryFn: ({ signal }) => flagsApi.list(query, { signal }),
  });
}

export function useFlag(id: string | undefined) {
  return useQuery({
    queryKey: [...flagKeys.all, 'detail', id ?? ''] as const,
    enabled: id !== undefined,
    queryFn: ({ signal }) => {
      if (id === undefined) throw new Error('A flag id is required');
      return flagsApi.get(id, { signal });
    },
  });
}
