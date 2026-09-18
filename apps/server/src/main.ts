import { createExpressApp } from './app-factory';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const server = await createExpressApp();
  const port = Number(process.env.PORT ?? 3001);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve()).on('error', reject);
  });

  const googleOn = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  console.log(`API listening on http://localhost:${port}`);
  console.log(
    `Google signup: ${
      googleOn
        ? 'enabled'
        : 'DISABLED — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in apps/server/.env'
    }`,
  );
  if (isProd) {
    console.log(`App: http://localhost:${port}`);
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
