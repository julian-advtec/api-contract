// src/common/guards/supervisor.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserRole } from '../../users/enums/user-role.enum';

@Injectable()
export class SupervisorGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    return user && (
      user.role === UserRole.SUPERVISOR || 
      user.role === UserRole.ADMIN
    );
  }
}