import { Global, Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CrmContextRegistry } from './crm-context';

/**
 * AI Sales Copilot (Agent F). OFF by default (platform_settings 'ai'.enabled=false). The CRM does not import this module;
 * Agent D binds data access via `CrmContextRegistry.register(provider)` (export below).
 */
@Global()
@Module({ controllers: [AiController], providers: [AiService, CrmContextRegistry], exports: [CrmContextRegistry] })
export class AiModule {}
