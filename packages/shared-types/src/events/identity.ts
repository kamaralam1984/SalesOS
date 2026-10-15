export const IDENTITY_EVENTS = {
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_CREATED: 'user.created',
  USER_ROLES_CHANGED: 'user.roles_changed',
  EMAIL_REQUESTED: 'notification.email.requested',
} as const;

export interface UserDeactivatedPayload {
  userId: string;
  organizationId: string;
  managerId: string | null;
  deactivatedById: string;
  reason: string | null;
}
export interface UserReactivatedPayload {
  userId: string;
  organizationId: string;
  reactivatedById: string;
}
export interface UserRolesChangedPayload {
  userId: string;
  organizationId: string;
  before: string[];
  after: string[];
  changedById: string;
}
export interface EmailRequestedPayload {
  to: string;
  template: 'password_reset' | 'invite';
  variables: Record<string, string>;
}
