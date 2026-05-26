// src/signatures/guards/signature-role.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ALLOWED_SIGNATURE_ROLES } from '../enums/allowed-signature-roles.enum';

@Injectable()
export class SignatureRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    console.log('========== SIGNATURE ROLE GUARD ==========');
    console.log('1. Request.user completo:', JSON.stringify(user, null, 2));
    
    if (!user) {
      console.error('❌ No user in request');
      throw new ForbiddenException('Usuario no autenticado');
    }

    // Obtener el rol de diferentes fuentes posibles
    let userRole = user.role || user.rol || user.userRole;
    
    console.log('2. Rol obtenido del user:', userRole);
    console.log('3. Tipo del rol:', typeof userRole);
    
    // Si el rol viene como objeto, extraer el valor
    if (userRole && typeof userRole === 'object') {
      userRole = userRole.value || userRole.name || Object.values(userRole)[0];
      console.log('4. Rol extraído de objeto:', userRole);
    }
    
    // Normalizar el rol
    const normalizedRole = userRole?.toString().toLowerCase().trim();
    console.log('5. Rol normalizado:', normalizedRole);
    
    // Mostrar roles permitidos
    const allowedRolesNormalized = ALLOWED_SIGNATURE_ROLES.map(r => r.toLowerCase().trim());
    console.log('6. Roles permitidos:', allowedRolesNormalized);
    
    // Verificar permisos
    const hasPermission = allowedRolesNormalized.includes(normalizedRole);
    
    console.log('7. ¿Tiene permiso?', hasPermission);
    console.log('==========================================');
    
    if (!hasPermission) {
      throw new ForbiddenException(
        `Tu rol "${userRole}" no tiene permitido tener firma digital. ` +
        `Roles permitidos: ${ALLOWED_SIGNATURE_ROLES.join(', ')}`
      );
    }
    
    return true;
  }
}