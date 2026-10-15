import Redis from 'ioredis';

/** BullMQ requires maxRetriesPerRequest: null on worker connections. */
export const createRedis = (url: string): Redis => new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
