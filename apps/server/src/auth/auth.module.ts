import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthRegistrar } from './google-oauth.registrar';
import { ClerkAuthService } from './clerk-auth.service';
import { MicrosoftStrategy } from './microsoft.strategy';
import { LoginCodeService } from './login-code.service';
import { LocalUserStore } from './local-user.store';
import { LocalDataStore } from './local-data.store';
import { UsersModule } from '../users/users.module';
import { CalendarModule } from '../calendar/calendar.module';

const oauthProviders = [];
if (
  process.env.MICROSOFT_CLIENT_ID?.trim() &&
  process.env.MICROSOFT_CLIENT_ID !== 'missing'
) {
  oauthProviders.push(MicrosoftStrategy);
}

@Module({
  imports: [
    PassportModule.register({ session: false }),
    forwardRef(() => UsersModule),
    forwardRef(() => CalendarModule),
  ],
  providers: [
    AuthService,
    GoogleOAuthRegistrar,
    ClerkAuthService,
    LoginCodeService,
    LocalUserStore,
    LocalDataStore,
    ...oauthProviders,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    GoogleOAuthRegistrar,
    ClerkAuthService,
    LocalUserStore,
    LocalDataStore,
  ],
})
export class AuthModule {}
