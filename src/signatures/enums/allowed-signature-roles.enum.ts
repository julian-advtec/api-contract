// signatures/enums/allowed-signature-roles.enum.ts
import { UserRole } from '../../users/enums/user-role.enum';

export const ALLOWED_SIGNATURE_ROLES = [
  UserRole.ADMIN,
  UserRole.ASESOR_GERENCIA,
  UserRole.RENDICION_CUENTAS,
  UserRole.TESORERIA
] as const;