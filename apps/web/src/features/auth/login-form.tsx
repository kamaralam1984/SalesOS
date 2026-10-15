'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, FormField, Input } from '@salesos/ui';
import { ApiError } from '@/lib/api/client';
import { useLogin, useMeQuery } from '@/lib/api/hooks/auth';
import { loginSchema, type LoginForm } from '@/lib/validation';
import { useFieldError } from '@/hooks/use-field-error';
import { AuthFrame, PasswordInput } from './auth-frame';
import { landingPathFor, safeNextPath } from './roles';
import { useOnline } from '@/components/shell/use-online';

const REASONS = ['expired', 'idle', 'signedout', 'reset', 'invited'] as const;

export function LoginPage() {
  const t = useTranslations('auth');
  const fe = useFieldError();
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const next = safeNextPath(params.get('next'));
  const reason = REASONS.find((r) => r === params.get('reason'));
  const me = useMeQuery();
  const login = useLogin();
  const [formError, setFormError] = React.useState<{
    title: string;
    body?: string;
    requestId?: string;
  } | null>(null);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in (e.g. opened /login in a new tab): go to the app.
  React.useEffect(() => {
    if (me.data) router.replace(next ?? landingPathFor(me.data.user.roles, me.data.permissions));
  }, [me.data, next, router]);

  async function onSubmit(values: LoginForm) {
    setFormError(null);
    try {
      await login.mutateAsync(values);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.isNetwork)
          setFormError({
            title: e.code === 'OFFLINE' ? t('errors.offlineTitle') : t('errors.networkTitle'),
            body: t('errors.networkBody'),
          });
        else if (e.status === 429 || e.status === 423 || /LOCK|THROTTLE|RATE/i.test(e.code))
          setFormError({
            title: t('errors.lockedTitle'),
            body: t('errors.lockedBody'),
            requestId: e.requestId,
          });
        else if (e.status === 401 || e.status === 400)
          setFormError({
            title: t('errors.invalidTitle'),
            body: t('errors.invalidBody'),
            requestId: e.requestId,
          });
        else
          setFormError({
            title: t('errors.genericTitle'),
            body: t('errors.genericBody'),
            requestId: e.requestId,
          });
      } else setFormError({ title: t('errors.genericTitle'), body: t('errors.genericBody') });
    }
  }

  const busy = form.formState.isSubmitting || login.isPending || Boolean(me.data);
  return (
    <AuthFrame
      title={t('loginTitle')}
      description={t('loginSubtitle')}
      footer={<p>{t('invitePrompt')}</p>}
    >
      {reason && (
        <Alert
          tone={
            reason === 'reset' || reason === 'invited' || reason === 'signedout'
              ? 'success'
              : 'warning'
          }
          className="mb-5"
          title={t(`reasons.${reason}.title`)}
        >
          {t(`reasons.${reason}.body`)}
        </Alert>
      )}
      {!online && (
        <Alert tone="warning" className="mb-5" title={t('errors.offlineTitle')}>
          {t('errors.offlineBody')}
        </Alert>
      )}
      {formError && (
        <Alert tone="danger" className="mb-5" title={formError.title}>
          {formError.body}
          {formError.requestId && (
            <span className="mt-1 block text-xs text-muted">
              {t('errors.reference')}: {formError.requestId}
            </span>
          )}
        </Alert>
      )}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="stagger space-y-5"
        aria-label={t('loginTitle')}
      >
        <FormField label={t('email')} error={fe(form.formState.errors.email)} required>
          <Input
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@company.com"
            {...form.register('email')}
          />
        </FormField>
        <FormField label={t('password')} error={fe(form.formState.errors.password)} required>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="rounded text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
          >
            {t('forgotLink')}
          </Link>
        </div>
        <Button
          type="submit"
          size="lg"
          className="glow-gold sheen w-full"
          loading={busy}
          loadingLabel={t('signingIn')}
          disabled={!online}
        >
          {t('signIn')}
        </Button>
      </form>
    </AuthFrame>
  );
}
