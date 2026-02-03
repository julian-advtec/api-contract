import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Si la ruta tiene @Public(), permite acceso sin token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      console.log('[JWT GUARD] Ruta pública detectada → acceso permitido sin token');
      return true;
    }

    // Ruta normal → validar JWT
    console.log('[JWT GUARD] Validando JWT...');
    return super.canActivate(context);
  }

  // Corregido: tipos explícitos + import de UnauthorizedException
  handleRequest(err: any, user: any, info: any): any {
    if (err || !user) {
      console.log('[JWT GUARD] Error o usuario no encontrado:', info?.message || err);
      throw err || new UnauthorizedException('No autorizado - token inválido o ausente');
    }
    return user;
  }
}