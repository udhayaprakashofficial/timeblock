import { NestFactory } from '@nestjs/core';
import { createNestApp } from './app-factory';

/**
 * Vercel Nest zero-config entrypoint.
 * Must import @nestjs/core and call app.listen(PORT).
 */
async function bootstrap() {
  const app = await createNestApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  const googleOn = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  console.log(`API listening on http://localhost:${port}`);
  console.log(
    `Google signup: ${
      googleOn
        ? 'enabled'
        : 'DISABLED — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET'
    }`,
  );
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed', err);
  // Re-throw so Vercel logs the real cause
  throw err;
});

// Keep NestFactory referenced for entrypoint detection / tree-shaking edge cases
export { NestFactory };
