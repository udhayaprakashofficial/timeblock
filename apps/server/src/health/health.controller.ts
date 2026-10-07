import { Controller, Get } from '@nestjs/common';

/** Public liveness probe — no auth. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      status: 'ok',
      service: 'timeblock-api',
      timestamp: new Date().toISOString(),
    };
  }
}
