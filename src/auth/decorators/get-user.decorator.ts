// src/auth/decorators/get-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Interfaz inline
interface JwtUser {
    id: string;
    userId: string;
    username: string;
    email: string;
    role: string;
}

export const GetUser = createParamDecorator(
    (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as JwtUser;
        
        if (!user) {
            return null;
        }
        
        return data ? user[data] : user;
    },
);