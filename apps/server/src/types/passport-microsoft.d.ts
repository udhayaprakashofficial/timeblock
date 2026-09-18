declare module 'passport-microsoft' {
  import { Strategy as PassportStrategy } from 'passport-strategy';

  export interface MicrosoftStrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
    tenant?: string;
    passReqToCallback?: boolean;
  }

  export class Strategy extends PassportStrategy {
    constructor(
      options: MicrosoftStrategyOptions,
      verify: (...args: unknown[]) => void,
    );
  }
}
