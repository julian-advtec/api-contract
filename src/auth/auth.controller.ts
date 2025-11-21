// auth.controller.ts - CORREGIDO (sin llave extra)
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Request,
  UnauthorizedException,
  BadRequestException
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// ✅ INTERFAZ PARA LA RESPUESTA DEL LOGIN
interface LoginResponse {
  success: boolean;
  message: string;
  requiresTwoFactor?: boolean;
  userId?: string;
  expiresIn?: string;
  access_token?: string;
  user?: any;
  debugNote?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  // 🔍 ENDPOINT DE DIAGNÓSTICO
  @Get('debug-all-users')
  async debugAllUsers() {
    try {
      const users = await this.authService.debugGetAllUsers();
      return {
        ok: true,
        totalUsers: users.length,
        users: users.map(user => ({
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          password: user.password ? '***' : 'null',
          hashed: !!user.password
        }))
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  // 🔍 CREAR USUARIO DE PRUEBA
  @Post('create-test-user')
  async createTestUser() {
    try {
      const testUser = {
        username: 'prueba2fa',
        email: 'prueba2fa@hospital.com',
        password: 'prueba123',
        role: 'user'
      };

      const user = await this.authService.debugCreateUser(testUser);

      return {
        ok: true,
        message: 'Usuario de prueba creado',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  // 🔍 LOGIN SIMPLE PARA DEBUG
  @Post('debug-login-simple')
  async debugLoginSimple(@Body() body: { username: string }) {
    const user = await this.authService.debugFindUser(body.username);

    if (!user) {
      throw new UnauthorizedException('Usuario no existe');
    }

    return {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      },
      message: 'Debug login exitoso'
    };
  }

  // ENDPOINTS ORIGINALES - CORREGIDOS
  @Post('login-direct')
  @HttpCode(HttpStatus.OK)
  async loginDirect(@Body() loginDto: LoginDto) {
    const result = await this.authService.loginDirect(loginDto);

    // ✅ CORRECCIÓN: Retornar directamente el resultado, no envolverlo en data
    return {
      ok: true,
      ...result,
      path: '/api/auth/login-direct',
      timestamp: new Date().toISOString()
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    try {
      const result = await this.authService.login(loginDto);

      // ✅ ESTRUCTURA UNIFICADA para el frontend
      const response: any = {
        ok: true,
        success: result.success,
        requiresTwoFactor: result.requiresTwoFactor,
        message: result.message,
        path: '/api/auth/login',
        timestamp: new Date().toISOString()
      };

      // ✅ Agregar propiedades condicionalmente - SIN ERRORES DE TIPO
      if (result.userId) {
        response.userId = result.userId;
        response.data = {
          requiresTwoFactor: result.requiresTwoFactor,
          userId: result.userId,
          expiresIn: result.expiresIn
        };
      }

      if (result.access_token) {
        response.access_token = result.access_token;
        response.user = result.user;
      }

      return response;
    } catch (error) {
      // ✅ Estructura de error consistente
      return {
        ok: false,
        success: false,
        message: error.message,
        path: '/api/auth/login',
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Body() body: { userId: string; code: string }) {
    try {
      const result = await this.authService.verifyTwoFactorCode(body.userId, body.code);

      return {
        ok: true,
        success: true,
        token: result.token,  // ✅ En nivel superior
        user: result.user,    // ✅ En nivel superior
        message: 'Verificación 2FA exitosa',
        path: '/api/auth/verify-2fa',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new BadRequestException({
        ok: false,
        success: false,
        message: error.message
      });
    }
  }

  @Post('resend-2fa')
  @HttpCode(HttpStatus.OK)
  async resendTwoFactorCode(@Body() body: { userId: string }) {
    try {
      await this.authService.resendTwoFactorCode(body.userId);
      return {
        ok: true,
        success: true,
        message: 'Nuevo código enviado correctamente'
      };
    } catch (error) {
      throw new BadRequestException({
        ok: false,
        success: false,
        message: error.message
      });
    }
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto);
    return {
      ok: true,
      user: result,
      message: 'Usuario registrado exitosamente'
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: any) {
    const user = await this.authService.getProfile(req.user.userId);
    return {
      ok: true,
      user
    };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    return {
      ok: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Auth Service',
      version: '1.0.0'
    };
  }

  @Post('debug-login')
  @HttpCode(HttpStatus.OK)
  async debugLogin(@Body() loginDto: LoginDto) {
    const result = await this.authService.debugLogin(loginDto);
    return {
      ok: true,
      ...result
    };
  }



  // En auth.controller.ts - AGREGAR ESTOS MÉTODOS
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email: string }) {
    try {
      await this.authService.forgotPassword(body.email);
      return {
        ok: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación'
      };
    } catch (error) {
      // Por seguridad, no revelar si el email existe o no
      return {
        ok: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación'
      };
    }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    try {
      await this.authService.resetPassword(body.token, body.newPassword);
      return {
        ok: true,
        message: 'Contraseña actualizada exitosamente'
      };
    } catch (error) {
      throw new BadRequestException({
        ok: false,
        message: error.message
      });
    }
  }

  @Post('validate-reset-token')
  @HttpCode(HttpStatus.OK)
  async validateResetToken(@Body() body: { token: string }) {
    try {
      const isValid = await this.authService.validateResetToken(body.token);
      return {
        ok: true,
        valid: isValid
      };
    } catch (error) {
      return {
        ok: true,
        valid: false
      };
    }
  }

}
// ✅ NO HAY LLAVE EXTRA AQUÍ - ESTE ES EL FINAL DEL ARCHIVO