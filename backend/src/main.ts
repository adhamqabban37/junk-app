import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // 3001, not 3000: the frontend's Next.js dev server also defaults to
  // 3000, and both are started as separate processes per the README --
  // sharing a default port means whichever starts second crashes with
  // EADDRINUSE. frontend/src/lib/api.ts's apiBaseUrl() fallback matches
  // this.
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
