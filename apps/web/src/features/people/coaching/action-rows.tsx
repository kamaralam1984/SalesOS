'use client';
import { useFieldArray, type Control, type FieldValues, type UseFormRegister } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Button, FormField, Input, Select } from '@salesos/ui';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  owners: { id: string; name: string }[];
  defaultOwnerId: string;
  errors?: Array<{ title?: { message?: unknown }; ownerId?: { message?: unknown } } | undefined>;
  fe: (e?: { message?: unknown } | null) => string | undefined;
}

/** Repeatable action-item rows: title, owner, due date. Used by sessions, 1:1s and reviews. */
export function ActionRows({ control, register, owners, defaultOwnerId, errors, fe }: Props) {
  const t = useTranslations('coaching');
  const { fields, append, remove } = useFieldArray<FieldValues>({ control, name: 'actions' });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink">{t('form.actions')}</legend>
      <p className="text-xs text-muted">{t('form.actionsHint')}</p>
      {fields.map((f, i) => (
        <div key={f.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end">
          <FormField label={t('form.actionTitle')} error={fe(errors?.[i]?.title)} required>
            <Input {...register(`actions.${i}.title`)} />
          </FormField>
          <FormField label={t('form.actionOwner')} error={fe(errors?.[i]?.ownerId)} required>
            <Select {...register(`actions.${i}.ownerId`)}>
              <option value="">{t('form.choose')}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('form.actionDue')}>
            <Input type="date" {...register(`actions.${i}.dueDate`)} />
          </FormField>
          <Button type="button" variant="ghost" size="icon" aria-label={t('form.removeAction')} onClick={() => remove(i)}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => append({ title: '', ownerId: defaultOwnerId, dueDate: '' })}>
        {t('form.addAction')}
      </Button>
    </fieldset>
  );
}
