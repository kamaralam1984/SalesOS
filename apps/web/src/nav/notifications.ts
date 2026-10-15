import { Bell, Bot, FolderLock, Paperclip, PlugZap } from 'lucide-react';
import type { NavDomain } from './types';

/** Notifications centre (Phase 8 owns this file). The top-bar bell links here. */
export const notificationsNav: NavDomain = {
  sectionKey: 'insights',
  items: [
    {
      id: 'notifications',
      labelKey: 'notifications',
      href: '/notifications',
      icon: Bell,
      permission: 'notifications:view',
      mobilePriority: null,
      order: 51,
    },
  ],
};

/** "My files" (Phase 8): upload, processing status and download for the signed-in user. */
export const filesNav: NavDomain = {
  sectionKey: 'workspace',
  items: [{ id: 'files', labelKey: 'files', href: '/files', icon: Paperclip, permission: 'files:view', mobilePriority: null, order: 52 }],
};

/** Platform administration entries (Phase 8): integrations + delivery log, AI Copilot, file storage. Listed under Administration. */
export const platformAdminNav: NavDomain = {
  sectionKey: 'administration',
  items: [
    { id: 'admin.integrations', labelKey: 'adminIntegrations', href: '/admin/integrations', icon: PlugZap, permission: 'integrations:manage', mobilePriority: null, order: 95 },
    { id: 'admin.files', labelKey: 'adminFiles', href: '/admin/files', icon: FolderLock, permission: 'integrations:manage', mobilePriority: null, order: 96 },
    { id: 'admin.ai', labelKey: 'adminAi', href: '/admin/ai', icon: Bot, permission: ['ai:config', 'ai:usage:view'], mobilePriority: null, order: 97 },
  ],
};
