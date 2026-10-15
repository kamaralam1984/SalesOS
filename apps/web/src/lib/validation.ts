import { z } from 'zod';

/**
 * Client-side form schemas. Messages are i18n KEYS under the `validation` namespace; render them through
 * `useFieldError()` so they translate. The API remains the authority (same rules, enforced server-side).
 */
export const emailField = z.string().trim().min(1, 'required').email('email').max(254, 'tooLong');

export const passwordField = z
  .string()
  .min(12, 'passwordMin')
  .max(128, 'tooLong')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'passwordComplexity',
  });

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'required').max(128, 'tooLong'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({ email: emailField });
export type ForgotForm = z.infer<typeof forgotSchema>;

export const setPasswordSchema = z
  .object({ password: passwordField, confirm: z.string().min(1, 'required') })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'passwordMismatch' });
export type SetPasswordForm = z.infer<typeof setPasswordSchema>;
