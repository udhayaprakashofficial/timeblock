import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private connected = false;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  async onModuleInit() {
    await this.tryConnect('startup');
    // Keep trying — Supabase DNS/network often comes up after boot.
    this.keepAlive = setInterval(() => {
      void this.tryConnect('keepalive');
    }, this.connected ? 60_000 : 10_000);
  }

  isConnected() {
    return this.connected;
  }

  async tryConnect(reason = 'manual') {
    try {
      if (this.connected) {
        await this.$queryRaw`SELECT 1`;
        return true;
      }
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      console.log(`[prisma] DATABASE_URL connected (${reason})`);
      this.rescheduleKeepAlive();
      return true;
    } catch (err) {
      const was = this.connected;
      this.connected = false;
      if (was || reason === 'startup') {
        console.error(
          `[prisma] DATABASE_URL unreachable (${reason}). Will keep retrying.`,
        );
        console.error(err instanceof Error ? err.message : String(err));
      }
      this.rescheduleKeepAlive();
      return false;
    }
  }

  private rescheduleKeepAlive() {
    if (!this.keepAlive) return;
    clearInterval(this.keepAlive);
    this.keepAlive = setInterval(() => {
      void this.tryConnect('keepalive');
    }, this.connected ? 60_000 : 10_000);
  }

  async onModuleDestroy() {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.connected) {
      await this.$disconnect();
    }
  }
}
