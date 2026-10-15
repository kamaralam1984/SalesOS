import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import {
  IS_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRE_ALL,
  REQUIRE_ANY,
} from '../../src/common/authz/decorators';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

export interface RouteInfo {
  controller: string;
  handler: string;
  method: string;
  path: string;
  isPublic: boolean;
  authenticatedOnly: boolean;
  requireAll: string[];
  requireAny: string[];
  hasMetadata: boolean;
}

/** Introspect every route registered in the app (used by the deny-by-default meta test and negative-test coverage). */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const reflector = new Reflector();
  const out: RouteInfo[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!ctrl) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined) ?? '';
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (name === 'constructor') continue;
        const handler = ctrl.prototype[name] as (...a: never[]) => unknown;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (method === undefined) continue;
        const rawPath = (Reflect.getMetadata(PATH_METADATA, handler) as string | string[]) ?? '';
        for (const path of Array.isArray(rawPath) ? rawPath : [rawPath]) {
          const targets = [handler, ctrl];
          const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
          const authenticatedOnly = !!reflector.getAllAndOverride<boolean>(
            IS_AUTHENTICATED,
            targets,
          );
          const requireAll = reflector.getAllAndOverride<string[]>(REQUIRE_ALL, targets) ?? [];
          const requireAny = reflector.getAllAndOverride<string[]>(REQUIRE_ANY, targets) ?? [];
          out.push({
            controller: ctrl.name,
            handler: name,
            method: METHODS[method] ?? String(method),
            path: `/${[base, path].filter(Boolean).join('/')}`
              .replace(/\/+/g, '/')
              .replace(/(.)\/$/, '$1'),
            isPublic,
            authenticatedOnly,
            requireAll,
            requireAny,
            hasMetadata:
              isPublic || authenticatedOnly || requireAll.length > 0 || requireAny.length > 0,
          });
        }
      }
    }
  }
  return out;
}
