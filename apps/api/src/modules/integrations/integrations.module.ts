import { Global, Module } from '@nestjs/common';
import { ProviderRegistry } from '@salesos/platform-core';
import { CallEventPortRegistry, StoringCallEventPort } from './call-event-port';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { encryptionKeyProvider } from './platform-config';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Integrations domain (Agent F): provider catalogue + config (encrypted secrets), delivery log/recovery, consent,
 * HMAC webhooks, provider call events. Global exports: ProviderRegistry, CallEventPortRegistry, ENCRYPTION_KEY provider.
 */
@Global()
@Module({
  controllers: [WebhooksController, IntegrationsController],
  providers: [
    encryptionKeyProvider,
    { provide: ProviderRegistry, useFactory: () => new ProviderRegistry() },
    StoringCallEventPort,
    { provide: CallEventPortRegistry, useFactory: (p: StoringCallEventPort) => new CallEventPortRegistry(p), inject: [StoringCallEventPort] },
    IntegrationsService,
    WebhooksService,
  ],
  exports: [ProviderRegistry, CallEventPortRegistry, encryptionKeyProvider],
})
export class IntegrationsModule {}
