import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauthReturnTo?: string;
    /** Web app origin where OAuth started (e.g. http://127.0.0.1:5173) */
    oauthWebOrigin?: string;
  }
}
