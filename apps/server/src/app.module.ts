import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ScheduleTemplatesModule } from './schedule/schedule.module';
import { TasksModule } from './tasks/tasks.module';
import { TimerModule } from './timer/timer.module';
import { StatsModule } from './stats/stats.module';
import { CalendarModule } from './calendar/calendar.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    // Cron jobs are not reliable on Vercel serverless cold starts
    ...(process.env.VERCEL ? [] : [ScheduleModule.forRoot()]),
    PrismaModule,
    CryptoModule,
    SupabaseModule,
    AuthModule,
    UsersModule,
    ScheduleTemplatesModule,
    TasksModule,
    TimerModule,
    StatsModule,
    CalendarModule,
  ],
})
export class AppModule {}
