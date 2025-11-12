import { 
  Controller, 
  Post, 
  Body, 
  UseGuards, 
  HttpCode, 
  HttpStatus, 
  Get, 
  Request,
  UnauthorizedException 
} from '@nestjs/common';
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
        role: 'user' // 🔥 Usar string directamente
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
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      },
      message: 'Debug login exitoso'
    };
  }

  // ENDPOINTS ORIGINALES
  @Post('login-direct')
  @HttpCode(HttpStatus.OK)
  async loginDirect(@Body() loginDto: LoginDto) {
    return this.authService.loginDirect(loginDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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

  @Post('debug-login')
  @HttpCode(HttpStatus.OK)
  async debugLogin(@Body() loginDto: LoginDto) {
    return this.authService.debugLogin(loginDto);
  }
}