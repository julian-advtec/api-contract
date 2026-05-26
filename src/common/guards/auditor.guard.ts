import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
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

    // Ruta protegida → validar permisos
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      console.log('[AUDITOR GUARD] No hay usuario autenticado → denegado');
      return false;
    }

    // ✅ ADMIN siempre permitido
    if (user.role === UserRole.ADMIN) {
      console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (ADMIN)`);
      return true;
    }

    // ✅ AUDITOR_CUENTAS siempre permitido
    if (user.role === UserRole.AUDITOR_CUENTAS) {
      console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (AUDITOR)`);
      return true;
    }

    // ✅ SUPERVISOR: solo permitir métodos GET (solo lectura)
    if (user.role === UserRole.SUPERVISOR) {
      const method = request.method;
      const url = request.url;
      
      // Permitir solo métodos GET
      if (method === 'GET') {
        console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (GET - solo lectura)`);
        return true;
      }
      
      // Bloquear métodos de escritura (POST, PUT, DELETE)
      console.log(`[AUDITOR GUARD] Supervisor ${user.username} intentando ${method} en ${url} → denegado`);
      throw new ForbiddenException('Los supervisores solo tienen acceso de lectura a auditoría');
    }

    if (user.role === UserRole.CONTABILIDAD) {
      const method = request.method;
      const url = request.url;
      
      // Permitir solo métodos GET
      if (method === 'GET') {
        console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (GET - solo lectura)`);
        return true;
      }
      
      // Bloquear métodos de escritura (POST, PUT, DELETE)
      console.log(`[AUDITOR GUARD] Supervisor ${user.username} intentando ${method} en ${url} → denegado`);
      throw new ForbiddenException('Los supervisores solo tienen acceso de lectura a auditoría');
    }
    if (user.role === UserRole.ASESOR_GERENCIA) {
      const method = request.method;
      const url = request.url;
      
      // Permitir solo métodos GET
      if (method === 'GET') {
        console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (GET - solo lectura)`);
        return true;
      }
      
      // Bloquear métodos de escritura (POST, PUT, DELETE)
      console.log(`[AUDITOR GUARD] Supervisor ${user.username} intentando ${method} en ${url} → denegado`);
      throw new ForbiddenException('Los supervisores solo tienen acceso de lectura a auditoría');
    }

    if (user.role === UserRole.RENDICION_CUENTAS) {
      const method = request.method;
      const url = request.url;
      
      // Permitir solo métodos GET
      if (method === 'GET') {
        console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (GET - solo lectura)`);
        return true;
      }
      
      // Bloquear métodos de escritura (POST, PUT, DELETE)
      console.log(`[AUDITOR GUARD] Supervisor ${user.username} intentando ${method} en ${url} → denegado`);
      throw new ForbiddenException('Los supervisores solo tienen acceso de lectura a auditoría');
    }

    if (user.role === UserRole.TESORERIA) {
      const method = request.method;
      const url = request.url;
      
      // Permitir solo métodos GET
      if (method === 'GET') {
        console.log(`[AUDITOR GUARD] Usuario: ${user.username} | Rol: ${user.role} → permitido (GET - solo lectura)`);
        return true;
      }
      
      // Bloquear métodos de escritura (POST, PUT, DELETE)
      console.log(`[AUDITOR GUARD] Supervisor ${user.username} intentando ${method} en ${url} → denegado`);
      throw new ForbiddenException('Los supervisores solo tienen acceso de lectura a auditoría');
    }




    console.log(`[AUDITOR GUARD] Usuario: ${user.username || user.id} | Rol: ${user.role} → denegado`);
    return false;
  }
}