import { NestFactory } from '@nestjs/core';
import { createNestApp } from './app-factory';

/**
 * Local / non-serverless entry. Vercel uses api/index.js instead.
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
  process.exit(1);
});

export { NestFactory };
