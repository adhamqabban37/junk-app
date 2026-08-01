import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The PWA frontend is always a different origin from this API (different
  // port in dev, different subdomain in prod) — no cookies are used (JWT
  // goes via Authorization header), so credentials aren't required, but CORS
  // still has to be explicitly enabled or the browser blocks every request.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
