import { zodResolver } from '@hookform/resolvers/zod';
import { actionContentSchema } from '@centurion/contracts';
import type { ActionContent, ActionDto } from '@centurion/contracts';
import { Controller, useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';

import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { useCreateAction, useUpdateAction } from '../../hooks/useActions';
import {
  actionToFormValues,
  brokersToText,
  defaultKafkaConfig,
  defaultWebhookConfig,
  headersToText,
  isKafkaConfig,
  isWebhookConfig,
  textToBrokers,
  textToHeaders,
} from '../../lib/action-drafts';
import { collectErrorMessages } from '../../lib/form-errors';
import type { ActionFormValues } from '../../types/action-form';

export interface ActionFormProps {
  initialAction?: ActionDto;
  actionId?: string;
  onSaved?: (action: ActionDto) => void;
  onCancel?: () => void;
}

const TYPE_OPTIONS = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'kafka_topic', label: 'Kafka topic' },
];

/** Bridges zod's recursive Description input typing to the concrete form values. */
const actionFormResolver = zodResolver(actionContentSchema) as unknown as Resolver<
  ActionFormValues,
  unknown,
  ActionContent
>;

export function ActionForm({ initialAction, actionId, onSaved, onCancel }: ActionFormProps) {
  const createAction = useCreateAction();
  const updateAction = useUpdateAction();
  const { toast } = useToast();

  const form = useForm<ActionFormValues, unknown, ActionContent>({
    resolver: actionFormResolver,
    defaultValues:
      initialAction !== undefined
        ? actionToFormValues(initialAction)
        : { type: 'webhook', name: '', enabled: true, config: defaultWebhookConfig() },
    mode: 'onTouched',
  });

  const type = form.watch('type');
  const config = form.watch('config');
  const errorMessages = Array.from(new Set(collectErrorMessages(form.formState.errors)));

  const handleTypeChange = (nextType: ActionFormValues['type']) => {
    if (form.getValues('type') === nextType) return;
    form.setValue('type', nextType, { shouldDirty: true, shouldValidate: true });
    form.setValue('config', nextType === 'webhook' ? defaultWebhookConfig() : defaultKafkaConfig(), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const onSubmit = form.handleSubmit(async (content) => {
    try {
      const saved =
        actionId !== undefined
          ? await updateAction.mutateAsync({ id: actionId, content })
          : await createAction.mutateAsync(content);
      toast({ title: 'Action saved', variant: 'success' });
      onSaved?.(saved);
    } catch (caught) {
      toast({
        title: 'Could not save action',
        description: errorMessage(caught),
        variant: 'error',
      });
    }
  });

  const isSaving = createAction.isPending || updateAction.isPending;
  const webhook = type === 'webhook' && isWebhookConfig(config) ? config : undefined;
  const kafka = type === 'kafka_topic' && isKafkaConfig(config) ? config : undefined;

  const updateConfig = (next: ActionFormValues['config']) => {
    form.setValue('config', next, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      {errorMessages.length > 0 && (
        <div
          role="alert"
          data-testid="action-form-errors"
          className="rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm font-semibold text-red-900">This action cannot be saved yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-red-800">
            {errorMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <Input
        label="Name"
        placeholder="Ops webhook"
        {...form.register('name')}
        error={form.formState.errors.name?.message}
      />

      <Select
        label="Type"
        value={type}
        options={TYPE_OPTIONS}
        onChange={(event) =>
          handleTypeChange(event.target.value === 'kafka_topic' ? 'kafka_topic' : 'webhook')
        }
      />

      <Controller
        control={form.control}
        name="enabled"
        render={({ field }) => (
          <Checkbox
            label="Enabled"
            checked={field.value}
            onChange={(event) => field.onChange(event.target.checked)}
          />
        )}
      />

      {webhook !== undefined && (
        <div className="space-y-3">
          <Input
            label="URL"
            type="url"
            placeholder="https://hooks.example.com/centurion"
            value={webhook.url}
            onChange={(event) => updateConfig({ ...webhook, url: event.target.value })}
          />
          <Input
            label="Timeout (ms)"
            type="number"
            min={1}
            max={60_000}
            value={webhook.timeoutMs ?? ''}
            onChange={(event) =>
              updateConfig({
                ...webhook,
                timeoutMs: event.target.value === '' ? undefined : Number(event.target.value),
              })
            }
          />
          <Textarea
            label="Headers (optional, one Key: value per line)"
            rows={3}
            value={headersToText(webhook.headers)}
            onChange={(event) => updateConfig({ ...webhook, headers: textToHeaders(event.target.value) })}
          />
          <div className="space-y-1">
            <Input
              label="Secret"
              type="password"
              autoComplete="new-password"
              placeholder={
                initialAction?.hasSecret === true
                  ? 'Configured — leave blank to keep it'
                  : 'Optional'
              }
              value={webhook.secret ?? ''}
              onChange={(event) =>
                updateConfig({
                  ...webhook,
                  secret: event.target.value === '' ? undefined : event.target.value,
                })
              }
            />
            <div className="flex items-center gap-2">
              {initialAction?.hasSecret === true && <Badge variant="success">configured</Badge>}
              <span className="text-xs text-slate-500">
                Write-only: the API never returns the secret.
              </span>
            </div>
          </div>
        </div>
      )}

      {kafka !== undefined && (
        <div className="space-y-3">
          <Input
            label="Topic"
            placeholder="logs.flags"
            value={kafka.topic}
            onChange={(event) => updateConfig({ ...kafka, topic: event.target.value })}
          />
          <Textarea
            label="Brokers (optional, one per line)"
            rows={3}
            value={brokersToText(kafka.brokers)}
            onChange={(event) =>
              updateConfig({ ...kafka, brokers: textToBrokers(event.target.value) })
            }
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel !== undefined && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSaving}>
          Save action
        </Button>
      </div>
    </form>
  );
}
