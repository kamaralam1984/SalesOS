import { Global, Module } from '@nestjs/common';
import { Env, loadEnv } from './env';

export const APP_ENV = Symbol('APP_ENV');

/** Fails fast at bootstrap when the environment is invalid. */
@Global()
@Module({
  providers: [{ provide: APP_ENV, useFactory: (): Env => loadEnv() }],
  exports: [APP_ENV],
})
export class AppConfigModule {}
