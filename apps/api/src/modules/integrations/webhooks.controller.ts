import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/authz';
import { WebhooksService } from './webhooks.service';

type RawRequest = Request & { rawBody?: Buffer };

/**
 * Inbound provider webhooks. PUBLIC by necessity (providers have no session): authenticity comes from the HMAC signature
 * over the raw body, the +-5 minute timestamp window and replay protection (docs/platform-report.md section 2).
 */
@ApiTags('integrations')
@Controller('integrations')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Public()
  @Post('telephony/webhook')
  @HttpCode(200)
  telephony(@Req() req: RawRequest, @Headers('x-signature') sig: string | undefined, @Headers('x-provider') provider?: string) {
    return this.svc.handle(provider && /^[a-z0-9-]{2,40}$/.test(provider) ? provider : 'sandbox-telephony', req.rawBody, sig, { telephonyOnly: true });
  }

  @Public()
  @Post('webhooks/:provider')
  @HttpCode(200)
  generic(@Param('provider') provider: string, @Req() req: RawRequest, @Headers('x-signature') sig: string | undefined) {
    return this.svc.handle(provider.toLowerCase().slice(0, 40), req.rawBody, sig);
  }
}
