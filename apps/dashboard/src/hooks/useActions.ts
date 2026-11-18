import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ActionContent } from '@centurion/contracts';

import { actionsApi } from '../api/actions';

export const actionKeys = {
  all: ['actions'] as const,
  list: () => [...actionKeys.all, 'list'] as const,
  detail: (id: string) => [...actionKeys.all, 'detail', id] as const,
  executions: (id: string) => [...actionKeys.all, 'executions', id] as const,
};

export function useActions() {
  return useQuery({
    queryKey: actionKeys.list(),
    queryFn: ({ signal }) => actionsApi.list({ signal }),
  });
}

export function useActionExecutions(actionId: string) {
  return useQuery({
    queryKey: actionKeys.executions(actionId),
    queryFn: ({ signal }) => actionsApi.executions(actionId, { signal }),
    retry: false,
    staleTime: 30_000,
  });
}

export function useCreateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: ActionContent) => actionsApi.create(content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}

export function useUpdateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; content: ActionContent }) =>
      actionsApi.update(input.id, input.content),
    onSuccess: (action) => {
      void queryClient.invalidateQueries({ queryKey: actionKeys.all });
      void queryClient.invalidateQueries({ queryKey: actionKeys.detail(action.id) });
    },
  });
}

export function useDeleteAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => actionsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}
