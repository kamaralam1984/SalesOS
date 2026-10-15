import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/common/prisma';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

/**
 * Boots the real AppModule + real HTTP pipeline (helmet, cookies, CORS, guards, envelope) against the test DB.
 * `extraControllers` lets a test mount probe routes (e.g. an HR-only endpoint) without touching production code.
 */
export async function createTestApp(opts: { extraControllers?: Type<unknown>[]; customize?: (b: TestingModuleBuilder) => TestingModuleBuilder } = {}): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers: opts.extraControllers ?? [] });
  if (opts.customize) builder = opts.customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, { useLogger: false });
  await app.init();
  return { app, prisma: app.get(PrismaService), close: () => app.close() };
}
