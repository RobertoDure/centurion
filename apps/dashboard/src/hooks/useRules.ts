import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { RuleContent } from '@centurion/contracts';

import { rulesApi } from '../api/rules';

export const ruleKeys = {
  all: ['rules'] as const,
  list: () => [...ruleKeys.all, 'list'] as const,
  detail: (id: string) => [...ruleKeys.all, 'detail', id] as const,
  versions: (id: string) => [...ruleKeys.all, 'versions', id] as const,
};

export function useRules() {
  return useQuery({
    queryKey: ruleKeys.list(),
    queryFn: ({ signal }) => rulesApi.list({ signal }),
  });
}

export function useRule(id: string | undefined) {
  return useQuery({
    queryKey: ruleKeys.detail(id ?? ''),
    enabled: id !== undefined,
    queryFn: ({ signal }) => {
      if (id === undefined) throw new Error('A rule id is required');
      return rulesApi.get(id, { signal });
    },
  });
}

export function useRuleVersions(id: string | undefined) {
  return useQuery({
    queryKey: ruleKeys.versions(id ?? ''),
    enabled: id !== undefined,
    queryFn: ({ signal }) => {
      if (id === undefined) throw new Error('A rule id is required');
      return rulesApi.versions(id, { signal });
    },
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: RuleContent) => rulesApi.create(content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; content: RuleContent }) =>
      rulesApi.update(input.id, input.content),
    onSuccess: (rule) => {
      void queryClient.invalidateQueries({ queryKey: ruleKeys.all });
      void queryClient.invalidateQueries({ queryKey: ruleKeys.detail(rule.id) });
      void queryClient.invalidateQueries({ queryKey: ruleKeys.versions(rule.id) });
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rulesApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}

export function useToggleRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      input.enabled ? rulesApi.enable(input.id) : rulesApi.disable(input.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    },
  });
}

export function useTestRule() {
  return useMutation({ mutationFn: rulesApi.test });
}
