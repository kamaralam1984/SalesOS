import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CoachEasily SalesOS API')
    .setDescription(
      'All responses use the envelope { data, meta, error }. Cookie session auth; send x-csrf-token on unsafe methods.',
    )
    .setVersion('1.0')
    .addCookieAuth('salesos_session')
    .addApiKey({ type: 'apiKey', name: 'x-csrf-token', in: 'header' }, 'csrf')
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/v1/openapi.json' });
}
