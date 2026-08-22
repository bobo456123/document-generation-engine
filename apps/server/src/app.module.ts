import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApplicationModule, HealthService } from '@bizdoc/application';

@Controller('health')
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  status(): { status: 'ok' } {
    return this.health.status();
  }
}

@Module({ imports: [ApplicationModule], controllers: [HealthController] })
export class AppModule {}
