// src/common/guards/supervisor.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { UserRole } from '../../users/enums/user-role.enum';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

@Injectable()
export class SupervisorGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Verificar si la ruta es pública
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si es pública, permitir acceso sin verificar rol
    if (isPublic) {
      console.log('[SUPERVISOR GUARD] Ruta pública detectada → acceso permitido');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // Para rutas protegidas, verificar rol
    const hasAccess = user && (
      user.role === UserRole.SUPERVISOR || 
      user.role === UserRole.ADMIN || 
      user.role === UserRole.CONTABILIDAD || 
      user.role === UserRole.TESORERIA || 
      user.role === UserRole.ASESOR_GERENCIA || 
      user.role === UserRole.RENDICION_CUENTAS 
    );

    if (!hasAccess) {
      console.log('[SUPERVISOR GUARD] Acceso denegado - Rol requerido: SUPERVISOR o ADMIN');
    }

    return hasAccess;
  }
}