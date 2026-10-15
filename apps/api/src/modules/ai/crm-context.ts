import { Injectable } from '@nestjs/common';
import type { CrmContextProvider, CrmContextResult } from '@salesos/shared-types';

const NA = { available: false as const, reason: 'CRM data source is not connected to the AI module' };

/** Default until Agent D binds a real provider. */
export class NotAvailableCrmContextProvider implements CrmContextProvider {
  async getLeadContext(): Promise<CrmContextResult> { return NA; }
  async listLeadSignals() { return NA; }
}

/** Domains register their provider in onModuleInit: `registry.register(myProvider)`. The provider MUST enforce the caller's scope. */
@Injectable()
export class CrmContextRegistry implements CrmContextProvider {
  private provider: CrmContextProvider = new NotAvailableCrmContextProvider();
  register(p: CrmContextProvider) { this.provider = p; }
  getLeadContext(user: { id: string; organizationId: string }, leadId: string) { return this.provider.getLeadContext(user, leadId); }
  listLeadSignals(user: { id: string; organizationId: string }, limit: number) { return this.provider.listLeadSignals(user, limit); }
}
