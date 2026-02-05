import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET no definido en .env');

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    };

    super(options);
  }

async validate(payload: any) {
  console.log('[JWT STRATEGY] Payload recibido:', JSON.stringify(payload, null, 2));

  const user = {
    id: payload.userId || payload.id,           // ← Cambia userId → id
    username: payload.username,
    role: payload.role?.toLowerCase(),
    email: payload.email,
  };

  console.log('[JWT STRATEGY] Usuario devuelto al request:', JSON.stringify(user, null, 2));

  return user;
}
}