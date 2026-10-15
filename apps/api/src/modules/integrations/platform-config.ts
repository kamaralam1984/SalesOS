import { loadEncryptionKey } from '@salesos/platform-core';

/** DI tokens shared by the platform modules. */
export const ENCRYPTION_KEY = Symbol('PLATFORM_ENCRYPTION_KEY');
export const encryptionKeyProvider = { provide: ENCRYPTION_KEY, useFactory: () => loadEncryptionKey() };
