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
    console.log('[JWT STRATEGY] Payload COMPLETO recibido:', JSON.stringify(payload, null, 2));
    console.log('[JWT STRATEGY] Campos del payload:', Object.keys(payload));
    console.log('[JWT STRATEGY] Valor de role:', payload.role);
    console.log('[JWT STRATEGY] Valor de rol (por si acaso):', payload.rol);
    console.log('[JWT STRATEGY] Valor de userRole:', payload.userRole);

    // Intenta encontrar el rol en diferentes campos
    const roleValue = payload.role || payload.rol || payload.userRole || payload.user_role;

    console.log('[JWT STRATEGY] Rol seleccionado:', roleValue);

    const user = {
      id: payload.userId || payload.id || payload.sub,
      username: payload.username || payload.userName,
      role: roleValue?.toLowerCase(),
      email: payload.email,
    };

    console.log('[JWT STRATEGY] Usuario final devuelto:', JSON.stringify(user, null, 2));

    return user;
  }
}