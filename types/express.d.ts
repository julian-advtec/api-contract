// src/types/express.d.ts
import { User } from '../users/entities/user.entity';

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        userId?: string;  // ✅ Hacer userId opcional para compatibilidad
        username: string;
        email: string;
        role: string;
        fullName?: string;
        iat?: number;
        exp?: number;
      };
    }
  }
}