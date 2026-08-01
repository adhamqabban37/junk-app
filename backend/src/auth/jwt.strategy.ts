import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // The JWT itself carries every claim a request needs (sub/tenantId/role) —
  // no DB round-trip here, since a long-lived token must keep authenticating
  // offline-launched PWA sessions without a network call.
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
