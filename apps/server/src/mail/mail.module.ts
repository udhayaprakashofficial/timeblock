import { Module } from '@nestjs/common';
import { BrevoMailService } from './brevo-mail.service';

@Module({
  providers: [BrevoMailService],
  exports: [BrevoMailService],
})
export class MailModule {}
