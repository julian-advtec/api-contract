// auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '../users/enums/user-role.enum';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';

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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) { }

  // ==================== REFRESH TOKEN ====================
  async refreshToken(userId: string): Promise<{ token: string }> {
    this.logger.debug(`🔄 Refresh token solicitado para userId: ${userId}`);
    
    const user = await this.usersService.findById(userId);
    if (!user) {
      this.logger.error(`❌ Usuario no encontrado: ${userId}`);
      throw new UnauthorizedException('Usuario no encontrado');
    }
    
    if (!user.isActive) {
      this.logger.error(`❌ Usuario inactivo: ${user.username}`);
      throw new UnauthorizedException('Usuario inactivo');
    }
    
    
    const payload = {
      username: user.username,
      userId: user.id,
      role: user.role,
      email: user.email
    };
    
    const newToken = this.jwtService.sign(payload, {
      expiresIn: '30m'
    });
    
    const decoded = this.jwtService.decode(newToken) as any;
    const expiresIn = decoded?.exp ? Math.floor((decoded.exp * 1000 - Date.now()) / 1000) : 1800;
    
    this.logger.log(`✅ Token refrescado para usuario: ${user.username}`);
    this.logger.log(`📅 Nueva expiración en: ${Math.floor(expiresIn / 60)} minutos`);
    
    return { token: newToken };
  }

  // ==================== MÉTODOS DE DEBUG ====================
  async debugGetAllUsers() {
    return await this.usersService.findAll();
  }

  async debugCreateUser(userData: any) {
    return await this.usersService.create(userData);
  }

  async debugFindUser(username: string) {
    return await this.usersService.findByUsername(username);
  }

  // ==================== LOGIN DIRECTO ====================
  async loginDirect(loginDto: LoginDto) {
    try {
      const user = await this.validateUser(loginDto.username, loginDto.password);
      const payload = { username: user.username, userId: user.id, role: user.role, email: user.email };
      const token = this.jwtService.sign(payload, { expiresIn: '30m' });

      return {
        success: true,
        access_token: token,
        user,
        message: 'Login directo exitoso (bypass 2FA)',
      };
    } catch (error) {
      this.logger.error('Error en loginDirect:', error);
      throw error;
    }
  }

  // ==================== VALIDAR USUARIO ====================
  async validateUser(username: string, password: string) {
    this.logger.debug(`🔍 Buscando usuario: ${username}`);

    const user = await this.usersService.findByUsername(username);
    this.logger.debug(`🔍 Resultado búsqueda: ${user ? 'ENCONTRADO' : 'NO ENCONTRADO'}`);

    if (!user) {
      this.logger.error(`❌ Usuario no encontrado: ${username}`);
      throw new UnauthorizedException('Usuario no encontrado');
    }

    this.logger.debug(`🔍 Usuario encontrado: ${user.username}, ID: ${user.id}, Rol: ${user.role}`);
    this.logger.debug(`🔍 Comparando contraseña...`);

    const isMatch = await bcrypt.compare(password, user.password);
    this.logger.debug(`🔍 Resultado comparación contraseña: ${isMatch ? 'CORRECTA' : 'INCORRECTA'}`);

    if (!isMatch) {
      this.logger.error(`❌ Contraseña incorrecta para usuario: ${username}`);
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    this.logger.debug(`✅ Usuario validado correctamente: ${user.username}`);

    const { password: _, ...result } = user;
    return result;
  }

  // ==================== LOGIN CON 2FA ====================
  async login(loginDto: LoginDto): Promise<LoginResponse> {
    try {
      this.logger.debug(`🔐 Intento de login para usuario: ${loginDto.username}`);

      const user = await this.validateUser(loginDto.username, loginDto.password);

      if (!user || !user.id || !user.username || !user.role) {
        throw new InternalServerErrorException('Datos de usuario incompletos');
      }

      this.logger.debug(`✅ Usuario validado: ${user.username} (${user.role})`);

      if (user.role === UserRole.ADMIN) {
        this.logger.debug(`👑 Admin login - bypassing 2FA`);
        const tokenResult = this.generateToken(user, false, 'Login admin exitoso (2FA bypass)');
        return {
          success: true,
          message: tokenResult.message || 'Login admin exitoso',
          access_token: tokenResult.access_token,
          user: tokenResult.user,
          requiresTwoFactor: false
        };
      }

      const emailConfigured = this.emailService.isEmailConfigured();
      this.logger.debug(`📧 Email service configurado: ${emailConfigured}`);

      if (!emailConfigured) {
        this.logger.warn(`📧 Email service no configurado para usuario: ${user.username}, omitiendo 2FA`);
        const tokenResult = this.generateToken(user, false, 'Login exitoso (2FA desactivado - servicio de email no configurado)');
        return {
          success: true,
          message: tokenResult.message || 'Login exitoso (2FA desactivado)',
          access_token: tokenResult.access_token,
          user: tokenResult.user,
          requiresTwoFactor: false
        };
      }

      if (!user.email || !user.email.includes('@')) {
        this.logger.error(`❌ Usuario ${user.username} no tiene email válido: ${user.email}`);
        throw new BadRequestException('Configuración de email inválida para 2FA');
      }

      this.logger.debug(`📧 Email válido encontrado: ${user.email}`);

      const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
      const twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);

      this.logger.debug(`🔢 Código 2FA generado: ${twoFactorCode}`);

      try {
        await this.usersService.updateTwoFactorCode(user.id, twoFactorCode, twoFactorExpires);
        this.logger.debug(`💾 Código 2FA guardado en BD para usuario: ${user.id}`);

        await this.emailService.sendTwoFactorCode(user.email, twoFactorCode);

        this.logger.log(`✅ Flujo 2FA iniciado para usuario: ${user.username}`);

        return {
          success: true,
          message: 'Código de verificación enviado a tu correo electrónico',
          userId: user.id,
          requiresTwoFactor: true,
          expiresIn: '10 minutos',
        };

      } catch (emailError) {
        this.logger.error(`❌ Error en flujo 2FA para ${user.username}:`, emailError.message);
        this.logger.warn(`🔐 CÓDIGO 2FA (FALLBACK) para ${user.email}: ${twoFactorCode}`);

        return {
          success: true,
          message: 'Código de verificación generado. Revisa los logs del servidor si no recibes el email.',
          userId: user.id,
          requiresTwoFactor: true,
          expiresIn: '10 minutos',
          debugNote: 'Email falló, código disponible en logs',
        };
      }

    } catch (error) {
      this.logger.error(`❌ Error en login para ${loginDto.username}:`, error.message);
      throw error;
    }
  }

  // ==================== VERIFICAR 2FA ====================
  async verifyTwoFactorCode(userId: string, code: string) {
    this.logger.debug(`🔐 Verificando 2FA para usuario: ${userId}, código: ${code}`);

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (!user.twoFactorExpires || new Date() > user.twoFactorExpires) {
      await this.usersService.clearTwoFactorCode(user.id);
      throw new Error('Código expirado');
    }

    if (user.twoFactorAttempts >= 3) {
      await this.usersService.clearTwoFactorCode(user.id);
      throw new Error('Máximo de intentos alcanzado');
    }

    if (user.twoFactorCode !== code) {
      await this.usersService.updateTwoFactorAttempts(user.id, user.twoFactorAttempts + 1);
      throw new Error('Código inválido');
    }

    await this.usersService.clearTwoFactorCode(user.id);

    const token = this.jwtService.sign({
      username: user.username,
      userId: user.id,
      role: user.role,
      email: user.email
    }, { expiresIn: '30m' });

    this.logger.log(`✅ 2FA verificado exitosamente para usuario: ${user.username}`);

    return { token, user };
  }

  // ==================== REENVIAR 2FA ====================
  async resendTwoFactorCode(userId: string) {
    this.logger.debug(`🔄 Reenviando código 2FA para usuario: ${userId}`);

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
    const twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);

    await this.usersService.updateTwoFactorCode(user.id, twoFactorCode, twoFactorExpires);

    try {
      await this.emailService.sendTwoFactorCode(user.email, twoFactorCode);
    } catch (emailError) {
      this.logger.error(`❌ Error reenviando email 2FA:`, emailError.message);
      this.logger.warn(`🔐 CÓDIGO 2FA (REENVÍO) para ${user.email}: ${twoFactorCode}`);
    }

    return {
      success: true,
      message: 'Código de verificación reenviado a tu correo electrónico',
      expiresIn: '10 minutos',
    };
  }

  // ==================== GENERAR TOKEN ====================
  private generateToken(user: any, requiresTwoFactor: boolean, message?: string) {
    const payload = {
      username: user.username,
      userId: user.id,
      role: user.role,
      email: user.email
    };
    const token = this.jwtService.sign(payload, { expiresIn: '30m' });

    return {
      success: true,
      access_token: token,
      user,
      requiresTwoFactor,
      message: message || 'Login exitoso',
    };
  }

  // ==================== REGISTRO ====================
  async register(registerDto: RegisterDto) {
    const { username, email, password, role } = registerDto;

    if (await this.usersService.findByUsername(username)) {
      throw new ConflictException('El nombre de usuario ya está en uso');
    }

    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('El email ya está registrado');
    }

    const createUserDto: CreateUserDto = {
      username,
      email,
      password,
      role,
      fullName: username
    };

    const user = await this.usersService.create(createUserDto);

    if (this.emailService.isEmailConfigured()) {
      try {
        await this.emailService.sendWelcomeEmail(user.email, user.username);
      } catch {
        this.logger.warn('No se pudo enviar email de bienvenida');
      }
    }

    return user;
  }

  // ==================== PERFIL ====================
  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return user;
  }

  // ==================== DEBUG LOGIN ====================
  async debugLogin(loginDto: LoginDto) {
    const result = await this.login(loginDto);
    return result;
  }

  // ==================== FORGOT PASSWORD ====================
  async forgotPassword(email: string): Promise<void> {
    this.logger.debug(`🔐 Forgot password request for email: ${email}`);
    
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      this.logger.debug(`🔐 Email not found: ${email}`);
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await this.usersService.updateResetToken(user.id, resetToken, resetTokenExpires);

    if (this.emailService.isEmailConfigured()) {
      try {
        await this.emailService.sendPasswordResetEmail(user.email, resetToken, user.username);
        this.logger.log(`✅ Password reset email sent to: ${user.email}`);
      } catch (emailError) {
        this.logger.error(`❌ Error sending reset email to ${user.email}:`, emailError.message);
        throw new Error('Error enviando el email de recuperación');
      }
    } else {
      this.logger.warn(`📧 Email service not configured, reset token: ${resetToken}`);
    }
  }

  // ==================== RESET PASSWORD ====================
  async resetPassword(token: string, newPassword: string): Promise<void> {
    this.logger.debug(`🔐 Resetting password with token: ${token}`);
    
    const user = await this.usersService.findByResetToken(token);
    if (!user) {
      throw new Error('Token de recuperación inválido');
    }

    if (!user.resetTokenExpires || new Date() > user.resetTokenExpires) {
      throw new Error('El token de recuperación ha expirado');
    }

    await this.usersService.updatePassword(user.id, newPassword);
    await this.usersService.clearResetToken(user.id);

    this.logger.log(`✅ Password reset successfully for user: ${user.username}`);
  }

  // ==================== VALIDATE RESET TOKEN ====================
  async validateResetToken(token: string): Promise<boolean> {
    const user = await this.usersService.findByResetToken(token);
    
    if (!user || !user.resetTokenExpires || new Date() > user.resetTokenExpires) {
      return false;
    }

    return true;
  }
}