import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Si la ruta tiene @Public(), salta validación de roles
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      console.log('[ROLES GUARD] Ruta pública detectada → sin validar roles');
      return true;
    }

    // Ruta protegida → validar roles
    const requiredRoles = this.reflector.get<UserRole[]>(
      'roles',
      context.getHandler(),
    );

    if (!requiredRoles) {
      console.log('[ROLES GUARD] No se requieren roles específicos → permitido');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      console.log('[ROLES GUARD] Usuario o rol no encontrado → denegado');
      return false;
    }

    const hasRole = requiredRoles.includes(user.role);
    console.log(`[ROLES GUARD] Usuario rol: ${user.role} | Requeridos: ${requiredRoles} → ${hasRole ? 'permitido' : 'denegado'}`);

    return hasRole;
  }
}