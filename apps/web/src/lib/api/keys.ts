/** Query-key factory. Each domain adds its own namespace here or in its own file using the same pattern. */
export const qk = {
  me: ['auth', 'me'] as const,
  users: {
    all: ['users'] as const,
    list: (q: object) => ['users', 'list', q] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  teams: {
    all: ['teams'] as const,
    list: (q: object) => ['teams', 'list', q] as const,
    detail: (id: string) => ['teams', 'detail', id] as const,
  },
  audit: { list: (q: object) => ['audit', 'list', q] as const },
  crm: { all: ['crm'] as const },
  orgSettings: ['org', 'settings'] as const,
  permissionCatalogue: ['permissions', 'catalogue'] as const,
};
