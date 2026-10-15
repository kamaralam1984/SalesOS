'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Alert, Button, FormField, Input } from '@salesos/ui';
import { ApiError } from '@/lib/api/client';
import { useAcceptInvite, useForgotPassword, useResetPassword } from '@/lib/api/hooks/auth';
import {
  forgotSchema,
  setPasswordSchema,
  type ForgotForm,
  type SetPasswordForm,
} from '@/lib/validation';
import { useFieldError } from '@/hooks/use-field-error';
import { AuthFrame, PasswordInput } from './auth-frame';

function BackToLogin() {
  const t = useTranslations('auth');
  return (
    <Link
      href="/login"
      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('backToSignIn')}
    </Link>
  );
}

export function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const fe = useFieldError();
  const forgot = useForgotPassword();
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(v: ForgotForm) {
    setError(null);
    try {
      await forgot.mutateAsync(v);
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.isNetwork
          ? t('errors.networkBody')
          : e instanceof ApiError && e.status === 429
            ? t('errors.lockedBody')
            : t('errors.genericBody'),
      );
    }
  }

  return (
    <AuthFrame title={t('forgotTitle')} description={t('forgotSubtitle')} footer={<BackToLogin />}>
      {sent ? (
        <Alert
          tone="success"
          title={t('forgotSentTitle')}
          actions={<MailCheck aria-hidden="true" className="size-5" />}
        >
          {t('forgotSentBody')}
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
          {error && (
            <Alert tone="danger" title={t('errors.genericTitle')}>
              {error}
            </Alert>
          )}
          <FormField label={t('email')} error={fe(form.formState.errors.email)} required>
            <Input
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              {...form.register('email')}
            />
          </FormField>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={forgot.isPending}
            loadingLabel={t('sending')}
          >
            {t('sendLink')}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

type Mode = 'reset' | 'invite';

function SetPasswordPage({ mode }: { mode: Mode }) {
  const t = useTranslations('auth');
  const fe = useFieldError();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const reset = useResetPassword();
  const accept = useAcceptInvite();
  const mutation = mode === 'reset' ? reset : accept;
  const [error, setError] = React.useState<{ title: string; body: string } | null>(null);
  const form = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const prefix = mode === 'reset' ? 'reset' : 'invite';

  async function onSubmit(v: SetPasswordForm) {
    setError(null);
    try {
      await mutation.mutateAsync({ token, password: v.password });
      router.replace(`/login?reason=${mode === 'reset' ? 'reset' : 'invited'}`);
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.status === 400 ||
          e.status === 404 ||
          e.status === 410 ||
          /TOKEN|EXPIRED|INVALID/i.test(e.code))
      ) {
        const fields = e.fieldErrors;
        if (fields.password) form.setError('password', { message: fields.password });
        else setError({ title: t('tokenInvalidTitle'), body: t('tokenInvalidBody') });
      } else if (e instanceof ApiError && e.isNetwork)
        setError({ title: t('errors.networkTitle'), body: t('errors.networkBody') });
      else setError({ title: t('errors.genericTitle'), body: t('errors.genericBody') });
    }
  }

  if (!token) {
    return (
      <AuthFrame title={t(`${prefix}Title`)} footer={<BackToLogin />}>
        <Alert tone="danger" title={t('tokenMissingTitle')}>
          {t('tokenMissingBody')}
        </Alert>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      title={t(`${prefix}Title`)}
      description={t(`${prefix}Subtitle`)}
      footer={<BackToLogin />}
    >
      {error && (
        <Alert tone="danger" className="mb-5" title={error.title}>
          {error.body}
        </Alert>
      )}
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
        <FormField
          label={t('newPassword')}
          hint={t('passwordHint')}
          error={fe(form.formState.errors.password)}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <FormField label={t('confirmPassword')} error={fe(form.formState.errors.confirm)} required>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </FormField>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={mutation.isPending}
          loadingLabel={t('saving')}
        >
          {t(`${prefix}Submit`)}
        </Button>
      </form>
    </AuthFrame>
  );
}

export const ResetPasswordPage = () => <SetPasswordPage mode="reset" />;
export const InviteAcceptPage = () => <SetPasswordPage mode="invite" />;
