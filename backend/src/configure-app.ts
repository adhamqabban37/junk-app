import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Shared between main.ts and every e2e test's app setup. Test files build
 * their app via `moduleFixture.createNestApplication()` directly, which
 * bypasses main.ts's bootstrap() entirely -- without calling this too, DTO
 * validation silently never ran in any e2e test (found via
 * settings.e2e-spec.ts's out-of-range-threshold test, which unexpectedly
 * got 200 instead of 400).
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The PWA frontend is always a different origin from this API (different
  // port in dev, different subdomain in prod) — no cookies are used (JWT
  // goes via Authorization header), so credentials aren't required, but CORS
  // still has to be explicitly enabled or the browser blocks every request.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  });
}
