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
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '../users/enums/user-role.enum';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) { }

  // 🔍 MÉTODOS DE DEBUG NUEVOS
  async debugGetAllUsers() {
    return await this.usersService.findAll();
  }

  async debugCreateUser(userData: any) {
    return await this.usersService.create(userData);
  }

  async debugFindUser(username: string) {
    return await this.usersService.findByUsername(username);
  }

  // ---------------- LOGIN DIRECTO ----------------
  async loginDirect(loginDto: LoginDto) {
    try {
      const user = await this.validateUser(loginDto.username, loginDto.password);
      const payload = { username: user.username, userId: user.id, role: user.role, email: user.email };
      const token = this.jwtService.sign(payload);

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

  // ---------------- VALIDAR USUARIO ----------------
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

  // ---------------- LOGIN CON 2FA - CORREGIDO ----------------
  async login(loginDto: LoginDto) {
    try {
      this.logger.debug(`🔐 Intento de login para usuario: ${loginDto.username}`);

      const user = await this.validateUser(loginDto.username, loginDto.password);

      if (!user || !user.id || !user.username || !user.role) {
        throw new InternalServerErrorException('Datos de usuario incompletos');
      }

      this.logger.debug(`✅ Usuario validado: ${user.username} (${user.role})`);

      // Bypass 2FA para admin
      if (user.role === UserRole.ADMIN) {
        this.logger.debug(`👑 Admin login - bypassing 2FA`);
        return this.generateToken(user, false, 'Login admin exitoso (2FA bypass)');
      }

      // Verificar configuración de email
      const emailConfigured = this.emailService.isEmailConfigured();
      this.logger.debug(`📧 Email service configurado: ${emailConfigured}`);

      if (!emailConfigured) {
        this.logger.warn(`📧 Email service no configurado para usuario: ${user.username}, omitiendo 2FA`);
        return this.generateToken(user, false, 'Login exitoso (2FA desactivado - servicio de email no configurado)');
      }

      // Verificar que el usuario tenga email válido
      if (!user.email || !user.email.includes('@')) {
        this.logger.error(`❌ Usuario ${user.username} no tiene email válido: ${user.email}`);
        throw new BadRequestException('Configuración de email inválida para 2FA');
      }

      this.logger.debug(`📧 Email válido encontrado: ${user.email}`);

      // Flujo normal 2FA
      const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
      const twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);

      this.logger.debug(`🔢 Código 2FA generado: ${twoFactorCode}`);

      try {
        // Guardar código en base de datos
        await this.usersService.updateTwoFactorCode(user.id, twoFactorCode, twoFactorExpires);
        this.logger.debug(`💾 Código 2FA guardado en BD para usuario: ${user.id}`);

        // Intentar enviar email
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
        
        // 🔥 OPCIÓN DE FALLBACK: Mostrar código en logs para desarrollo
        this.logger.warn(`🔐 CÓDIGO 2FA (FALLBACK) para ${user.email}: ${twoFactorCode}`);
        
        // Continuar con flujo 2FA aunque falle el email (el código está en BD)
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

  // ---------------- GENERAR TOKEN ----------------
  private generateToken(user: any, requiresTwoFactor: boolean, message?: string) {
    const payload = { 
      username: user.username, 
      userId: user.id, 
      role: user.role, 
      email: user.email 
    };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      access_token: token,
      user,
      requiresTwoFactor,
      message,
    };
  }

  // ---------------- VERIFICAR 2FA ----------------
  async verifyTwoFactor(userId: string, code: string) {
    this.logger.debug(`🔐 Verificando 2FA para usuario: ${userId}, código: ${code}`);
    
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

    if (!user.twoFactorCode || !user.twoFactorExpires) {
      throw new UnauthorizedException('Código no generado o expirado');
    }
    
    if (user.twoFactorExpires < new Date()) {
      throw new UnauthorizedException('Código expirado');
    }
    
    if (user.twoFactorCode !== code) {
      throw new UnauthorizedException('Código incorrecto');
    }

    await this.usersService.clearTwoFactorCode(user.id);

    this.logger.log(`✅ 2FA verificado exitosamente para usuario: ${user.username}`);
    
    return this.generateToken(user, false, 'Autenticación 2FA exitosa');
  }

  // ---------------- REENVIAR 2FA ----------------
  async resendTwoFactorCode(userId: string) {
    this.logger.debug(`🔄 Reenviando código 2FA para usuario: ${userId}`);
    
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

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

  // ---------------- REGISTRO ----------------
  async register(registerDto: RegisterDto) {
    const { username, email, password, role } = registerDto;

    if (await this.usersService.findByUsername(username))
      throw new ConflictException('El nombre de usuario ya está en uso');

    if (await this.usersService.findByEmail(email))
      throw new ConflictException('El email ya está registrado');

    const user = await this.usersService.create({ username, email, password, role });

    if (this.emailService.isEmailConfigured()) {
      try {
        await this.emailService.sendWelcomeEmail(user.email, user.username);
      } catch {
        this.logger.warn('No se pudo enviar email de bienvenida');
      }
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // ---------------- PERFIL ----------------
  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // ---------------- DEBUG LOGIN ----------------
  async debugLogin(loginDto: LoginDto) {
    const result = await this.login(loginDto);
    return result;
  }
}