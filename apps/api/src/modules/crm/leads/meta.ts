export const OUTCOMES = [
  { key: 'CONNECTED', label: 'Connected' },
  { key: 'NO_ANSWER', label: 'No answer' },
  { key: 'BUSY', label: 'Busy' },
  { key: 'SWITCHED_OFF', label: 'Switched off' },
  { key: 'CALLBACK', label: 'Callback requested' },
  { key: 'FAILED', label: 'Call failed' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
];
export const OBJECTIONS = ['PRICE', 'TIMING', 'TRUST', 'COMPETITOR', 'NEED_APPROVAL', 'NO_TIME', 'LANGUAGE', 'NOT_RELEVANT', 'OTHER'].map((k) => ({ key: k, label: k.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
export const TASK_TYPES = ['CALL', 'CALLBACK', 'FOLLOW_UP', 'DEMO', 'EMAIL', 'WEBINAR_REMINDER', 'ONBOARDING', 'MANAGER_REVIEW', 'OTHER'].map((k) => ({ key: k, label: k.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
