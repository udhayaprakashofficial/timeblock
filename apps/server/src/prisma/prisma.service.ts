import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private connected = false;

  async onModuleInit() {
    try {
      await this.$connect();
      this.connected = true;
    } catch (err) {
      this.connected = false;
      console.error(
        '[prisma] DATABASE_URL unreachable at startup. Google signup and API data will fail until Supabase is reachable.',
      );
      console.error(err instanceof Error ? err.message : String(err));
    }
  }

  isConnected() {
    return this.connected;
  }

  async onModuleDestroy() {
    if (this.connected) {
      await this.$disconnect();
    }
  }
}
