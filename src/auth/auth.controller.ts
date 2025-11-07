import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Get, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyTwoFactorDto } from './dto/verify-2fa.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ✅ NUEVO ENDPOINT - LOGIN DIRECTO SIN 2FA (SOLO PARA DESARROLLO)
  @Post('login-direct')
  @HttpCode(HttpStatus.OK)
  async loginDirect(@Body() loginDto: LoginDto) {
    console.log(`🔓 Login directo solicitado para: ${loginDto.username}`);
    
    const user = await this.authService.validateUser(loginDto.username, loginDto.password);
    
    if (!user) {
      throw new Error('Credenciales inválidas');
    }

    // ✅ BYPASS COMPLETO - Generar token directamente sin 2FA
    const payload = { 
      username: user.username, 
      userId: user.id, 
      role: user.role 
    };
    
    return {
      access_token: await this.authService.generateToken(payload),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      message: 'Login directo exitoso (bypass 2FA)'
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(loginDto.username, loginDto.password);
    return this.authService.login(user);
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Body() verifyTwoFactorDto: VerifyTwoFactorDto) {
    return this.authService.verifyTwoFactor(verifyTwoFactorDto.userId, verifyTwoFactorDto.code);
  }

  @Post('resend-2fa')
  @HttpCode(HttpStatus.OK)
  async resendTwoFactorCode(@Body() body: { userId: string }) {
    return this.authService.resendTwoFactorCode(body.userId);
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.userId);
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Auth Service',
      version: '1.0.0'
    };
  }
}