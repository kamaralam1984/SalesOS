import { ObjectStorage, storageConfigFromEnv } from '@salesos/platform-core';

export const STORAGE = Symbol('OBJECT_STORAGE');

/** Private bucket per environment (S3_BUCKET or salesos-<NODE_ENV>), created on first use / boot. */
export const storageProvider = { provide: STORAGE, useFactory: () => new ObjectStorage(storageConfigFromEnv()) };
