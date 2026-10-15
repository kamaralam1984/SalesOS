import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { OpsProbeService } from './ops-probe.service';

@Global()
@Module({ providers: [MetricsService, OpsProbeService], controllers: [MetricsController], exports: [MetricsService, OpsProbeService] })
export class ObservabilityModule {}
