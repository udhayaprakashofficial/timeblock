import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [BillingModule, UsersModule, MailModule],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
