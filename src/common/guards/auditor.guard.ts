import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Injectable()
export class AuditorGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Si la ruta tiene @Public(), permite acceso sin validar auditor
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      console.log('[AUDITOR GUARD] Ruta pública detectada → acceso permitido');
      return true;
    }

    // Ruta protegida → validar que sea auditor o admin
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      console.log('[AUDITOR GUARD] No hay usuario autenticado → denegado');
      return false;
    }

    const isAllowed = user.role === UserRole.AUDITOR_CUENTAS || user.role === UserRole.ADMIN;

    console.log(`[AUDITOR GUARD] Usuario: ${user.username || user.id} | Rol: ${user.role} → ${isAllowed ? 'permitido' : 'denegado'}`);

    return isAllowed;
  }
}