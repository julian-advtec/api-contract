import { Injectable, UnauthorizedException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '../users/enums/user-role.enum';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) { }

  // ✅ NUEVO MÉTODO - Generar token (para login-direct)
  async generateToken(payload: any): Promise<string> {
    return this.jwtService.sign(payload);
  }

  async validateUser(username: string, password: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    // ✅ BYPASS 2FA PARA ADMIN
    if (user.role === UserRole.ADMIN) {
      this.logger.log(`✅ Bypass 2FA para admin: ${user.username}`);

      const payload = {
        username: user.username,
        sub: user.id,
        role: user.role,
        email: user.email
      };

      const token = this.jwtService.sign(payload);

      return {
        success: true,
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        requiresTwoFactor: false,
        message: 'Login admin exitoso (2FA bypass)'
      };
    }

    // Verificar si el email está configurado
    if (!this.emailService.isEmailConfigured()) {
      this.logger.warn('Servicio de email no configurado. Generando token directo.');

      const payload = {
        username: user.username,
        sub: user.id,
        role: user.role,
        email: user.email
      };

      const token = this.jwtService.sign(payload);

      return {
        success: true,
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        requiresTwoFactor: false,
        message: 'Login exitoso (2FA desactivado - email no configurado)'
      };
    }

    // Flujo normal con 2FA para otros roles
    const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
    const twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);

    this.logger.log(`Generando código 2FA para usuario: ${user.username}`);

    await this.usersService.updateTwoFactorCode(user.id, twoFactorCode, twoFactorExpires);

    try {
      await this.emailService.sendTwoFactorCode(user.email, twoFactorCode);
      this.logger.log(`✅ Código 2FA enviado a: ${user.email}`);
    } catch (error) {
      this.logger.error('Error enviando código 2FA:', error);
      throw new BadRequestException('No se pudo enviar el código de verificación. Contacta al administrador.');
    }

    return {
      success: true,
      message: 'Código de verificación enviado a tu correo electrónico',
      userId: user.id,
      requiresTwoFactor: true,
      expiresIn: '10 minutos'
    };
  }

  async verifyTwoFactor(userId: string, code: string) {
    this.logger.log(`Verificando 2FA para usuario: ${userId}, código: ${code}`);

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    if (!user.twoFactorCode || !user.twoFactorExpires) {
      throw new UnauthorizedException('Código no generado o expirado');
    }

    if (user.twoFactorExpires < new Date()) {
      throw new UnauthorizedException('Código expirado. Por favor, inicia sesión nuevamente.');
    }

    if (user.twoFactorCode !== code) {
      throw new UnauthorizedException('Código incorrecto');
    }

    await this.usersService.clearTwoFactorCode(user.id);

    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
      email: user.email
    };

    const token = this.jwtService.sign(payload);

    this.logger.log(`✅ Autenticación 2FA exitosa para: ${user.username}`);

    return {
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
    };
  }

  async resendTwoFactorCode(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return this.login(user);
  }

  async register(registerDto: RegisterDto) {
    const { username, email, password, role } = registerDto;

    // Verificar si el usuario ya existe
    const existingUser = await this.usersService.findByUsername(username);
    if (existingUser) {
      throw new ConflictException('El nombre de usuario ya está en uso');
    }

    const existingEmail = await this.usersService.findByEmail(email);
    if (existingEmail) {
      throw new ConflictException('El email ya está registrado');
    }

    // Crear usuario
    const user = await this.usersService.create({
      username,
      email,
      password,
      role,
    });

    // Enviar email de bienvenida si está configurado
    if (this.emailService.isEmailConfigured()) {
      try {
        await this.emailService.sendWelcomeEmail(user.email, user.username);
      } catch (error) {
        this.logger.warn('No se pudo enviar email de bienvenida:', error);
      }
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}