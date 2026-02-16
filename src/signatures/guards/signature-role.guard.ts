// signatures/guards/signature-role.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ALLOWED_SIGNATURE_ROLES } from '../enums/allowed-signature-roles.enum';

@Injectable()
export class SignatureRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    console.log('🎭 Verificando rol para firma:', user.role); // 👈 DEBUG
    const hasPermission = ALLOWED_SIGNATURE_ROLES.includes(user.role);

    if (!hasPermission) {
      throw new ForbiddenException('Tu rol no tiene permitido tener firma digital');
    }

    return true;
  }
}
