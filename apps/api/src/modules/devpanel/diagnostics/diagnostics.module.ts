import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';
import { ErrorBufferService, RequestCaptureInterceptor } from './error-buffer.service';

/** Developer Panel / diagnostics: health latency, failed jobs, recent errors/slow requests, migrations, build info. */
@Module({
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, ErrorBufferService, { provide: APP_INTERCEPTOR, useClass: RequestCaptureInterceptor }],
})
export class DevDiagnosticsModule {}
