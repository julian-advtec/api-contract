// src/users/services/users.service.ts
import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';
import { UserRole } from './enums/user-role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private bitacoraService: BitacoraSistemaService,
  ) { }

  // 🔍 FIND METHODS
  async findByUsername(username: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({ where: { username } });
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuario por username');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({ where: { email } });
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuario por email');
    }
  }

  async findAll(): Promise<UserResponseDto[]> {
    try {
      const users = await this.usersRepository.find({
        order: { createdAt: 'DESC' }
      });
      return users.map(user => new UserResponseDto(user));
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo usuarios');
    }
  }

  async findWithFilters(filters: {
    search?: string;
    role?: UserRole;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ users: UserResponseDto[]; total: number }> {
    try {
      const { search, role, isActive, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      const queryBuilder = this.usersRepository.createQueryBuilder('user');

      if (search) {
        queryBuilder.andWhere(
          '(user.username LIKE :search OR user.email LIKE :search OR user.fullName LIKE :search)',
          { search: `%${search}%` }
        );
      }

      if (role) {
        queryBuilder.andWhere('user.role = :role', { role });
      }

      if (isActive !== undefined) {
        queryBuilder.andWhere('user.isActive = :isActive', { isActive });
      }

      const [users, total] = await queryBuilder
        .orderBy('user.createdAt', 'DESC')
        .skip(skip)
        .take(limit)
        .getManyAndCount();

      return {
        users: users.map(user => new UserResponseDto(user)),
        total
      };
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuarios con filtros');
    }
  }

  // ✨ CREATE & UPDATE METHODS
  async create(createUserDto: CreateUserDto, createdBy?: string): Promise<UserResponseDto> {
    try {
      console.log('Recibiendo datos para crear usuario:', createUserDto);

      // Verificar username único
      const existingUser = await this.findByUsername(createUserDto.username);
      if (existingUser) {
        throw new ConflictException('El nombre de usuario ya existe');
      }

      // Verificar email único
      const existingEmail = await this.findByEmail(createUserDto.email);
      if (existingEmail) {
        throw new ConflictException('El email ya está registrado');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(createUserDto.password, 12);

      const userData: any = {
        username: createUserDto.username,
        email: createUserDto.email,
        fullName: createUserDto.fullName,
        role: createUserDto.role,
        password: hashedPassword,
        isActive: createUserDto.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Solo agregar createdBy si se proporciona
      if (createdBy) {
        userData.createdBy = createdBy;
      }

      console.log('Datos del usuario a crear:', userData);

      const user = this.usersRepository.create(userData);
      const savedUser = await this.usersRepository.save(user);

      console.log('Usuario guardado:', savedUser);

      // 👇 CORREGIDO: Extraer el usuario correctamente (podría ser array o objeto)
      let usuarioGuardado: User;
      if (Array.isArray(savedUser)) {
        console.warn('savedUser es un array, tomando el primero');
        usuarioGuardado = savedUser[0];
        if (!usuarioGuardado) {
          throw new InternalServerErrorException('Error: No se pudo crear el usuario');
        }
      } else {
        usuarioGuardado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA (usando usuarioGuardado)
      const usuarioCreador = createdBy ? await this.findById(createdBy) : null;
      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_CREAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        usuarioCreador,
        null,
        {
          detalles: `Usuario creado: ${usuarioGuardado.username} (${usuarioGuardado.fullName}) - Rol: ${usuarioGuardado.role}`,
          usuarioCreado: usuarioGuardado.username,
          rolAsignado: usuarioGuardado.role
        }
      );

      return new UserResponseDto(usuarioGuardado);
    } catch (error) {
      console.error('Error en create:', error);
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error.code === '23505') {
        throw new ConflictException('El nombre de usuario o email ya existe');
      }
      throw new InternalServerErrorException(`Error creando usuario: ${error.message}`);
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto, updatedBy?: string): Promise<UserResponseDto> {
    try {
      console.log(`Actualizando usuario ${id}:`, updateUserDto);

      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Guardar cambios para la bitácora
      const cambios = [];
      if (updateUserDto.role && updateUserDto.role !== user.role) {
        cambios.push(`Rol: ${user.role} → ${updateUserDto.role}`);
      }
      if (updateUserDto.fullName && updateUserDto.fullName !== user.fullName) {
        cambios.push(`Nombre: ${user.fullName} → ${updateUserDto.fullName}`);
      }
      if (updateUserDto.username && updateUserDto.username !== user.username) {
        cambios.push(`Username: ${user.username} → ${updateUserDto.username}`);
      }
      if (updateUserDto.email && updateUserDto.email !== user.email) {
        cambios.push(`Email: ${user.email} → ${updateUserDto.email}`);
      }

      // Verificar username único (excluyendo el usuario actual)
      if (updateUserDto.username && updateUserDto.username !== user.username) {
        const existingUser = await this.usersRepository.findOne({
          where: { username: updateUserDto.username, id: Not(id) }
        });
        if (existingUser) {
          throw new ConflictException('El nombre de usuario ya está en uso');
        }
      }

      // Verificar email único (excluyendo el usuario actual)
      if (updateUserDto.email && updateUserDto.email !== user.email) {
        const existingEmail = await this.usersRepository.findOne({
          where: { email: updateUserDto.email, id: Not(id) }
        });
        if (existingEmail) {
          throw new ConflictException('El email ya está registrado');
        }
      }

      // Si se actualiza la contraseña, hashearla
      if (updateUserDto.password && updateUserDto.password.trim() !== '') {
        updateUserDto.password = await bcrypt.hash(updateUserDto.password, 12);
      } else {
        delete updateUserDto.password;
      }

      const updateData: any = {
        id,
        ...updateUserDto,
        updatedAt: new Date()
      };

      if (updatedBy) {
        updateData.updatedBy = updatedBy;
      }

      console.log('Datos de actualización:', updateData);

      const updatedUser = await this.usersRepository.preload(updateData);

      if (!updatedUser) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const savedUser = await this.usersRepository.save(updatedUser);

      console.log('Usuario actualizado:', savedUser);

      // 👇 CORREGIDO: Extraer el usuario correctamente
      let usuarioActualizado: User;
      if (Array.isArray(savedUser)) {
        usuarioActualizado = savedUser[0];
        if (!usuarioActualizado) {
          throw new InternalServerErrorException('Error: No se pudo actualizar el usuario');
        }
      } else {
        usuarioActualizado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA SI HUBO CAMBIOS
      if (cambios.length > 0) {
        const usuarioModificador = updatedBy ? await this.findById(updatedBy) : null;
        await this.bitacoraService.registrar(
          AccionBitacora.ADMIN_EDITAR_USUARIO,
          ModuloBitacora.ADMINISTRACION,
          usuarioModificador,
          null,
          {
            detalles: `Usuario editado: ${user.username} - Cambios: ${cambios.join(', ')}`,
            usuarioEditado: user.username,
            cambiosRealizados: cambios
          }
        );
      }

      return new UserResponseDto(usuarioActualizado);
    } catch (error) {
      console.error('Error en update:', error);
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      if (error.code === '23505') {
        throw new ConflictException('El nombre de usuario o email ya existe');
      }
      throw new InternalServerErrorException(`Error actualizando usuario: ${error.message}`);
    }
  }

  // 🚀 STATUS MANAGEMENT
  async toggleUserStatus(id: string, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const estadoAnterior = user.isActive;
      user.isActive = !user.isActive;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);

      // 👇 CORREGIDO: Extraer el usuario correctamente
      let usuarioActualizado: User;
      if (Array.isArray(savedUser)) {
        usuarioActualizado = savedUser[0];
        if (!usuarioActualizado) {
          throw new InternalServerErrorException('Error: No se pudo cambiar el estado del usuario');
        }
      } else {
        usuarioActualizado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA
      const usuarioModificador = updatedBy ? await this.findById(updatedBy) : null;
      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        usuarioModificador,
        null,
        {
          detalles: `Estado de usuario ${user.username} cambiado: ${estadoAnterior ? 'Activo' : 'Inactivo'} → ${!estadoAnterior ? 'Activo' : 'Inactivo'}`,
          usuarioEditado: user.username,
          estadoAnterior: estadoAnterior ? 'Activo' : 'Inactivo',
          estadoNuevo: !estadoAnterior ? 'Activo' : 'Inactivo'
        }
      );

      return new UserResponseDto(usuarioActualizado);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error cambiando estado del usuario');
    }
  }

  async activateUser(id: string, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const estabaInactivo = !user.isActive;
      user.isActive = true;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);

      // 👇 CORREGIDO: Extraer el usuario correctamente
      let usuarioActualizado: User;
      if (Array.isArray(savedUser)) {
        usuarioActualizado = savedUser[0];
        if (!usuarioActualizado) {
          throw new InternalServerErrorException('Error: No se pudo activar el usuario');
        }
      } else {
        usuarioActualizado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA SI ESTABA INACTIVO
      if (estabaInactivo) {
        const usuarioModificador = updatedBy ? await this.findById(updatedBy) : null;
        await this.bitacoraService.registrar(
          AccionBitacora.ADMIN_EDITAR_USUARIO,
          ModuloBitacora.ADMINISTRACION,
          usuarioModificador,
          null,
          {
            detalles: `Usuario activado: ${user.username}`,
            usuarioEditado: user.username,
            accion: 'ACTIVACION'
          }
        );
      }

      return new UserResponseDto(usuarioActualizado);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error activando usuario');
    }
  }

  async deactivateUser(id: string, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const estabaActivo = user.isActive;
      user.isActive = false;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);

      // 👇 CORREGIDO: Extraer el usuario correctamente
      let usuarioActualizado: User;
      if (Array.isArray(savedUser)) {
        usuarioActualizado = savedUser[0];
        if (!usuarioActualizado) {
          throw new InternalServerErrorException('Error: No se pudo desactivar el usuario');
        }
      } else {
        usuarioActualizado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA SI ESTABA ACTIVO
      if (estabaActivo) {
        const usuarioModificador = updatedBy ? await this.findById(updatedBy) : null;
        await this.bitacoraService.registrar(
          AccionBitacora.ADMIN_EDITAR_USUARIO,
          ModuloBitacora.ADMINISTRACION,
          usuarioModificador,
          null,
          {
            detalles: `Usuario desactivado: ${user.username}`,
            usuarioEditado: user.username,
            accion: 'DESACTIVACION'
          }
        );
      }

      return new UserResponseDto(usuarioActualizado);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error desactivando usuario');
    }
  }

  // 🗑️ DELETE METHODS
  async remove(id: string, deletedBy?: string): Promise<void> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // 👇 REGISTRAR EN BITÁCORA ANTES DE ELIMINAR
      const usuarioEliminador = deletedBy ? await this.findById(deletedBy) : null;
      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_ELIMINAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        usuarioEliminador,
        null,
        {
          detalles: `Usuario eliminado permanentemente: ${user.username} (${user.fullName}) - Rol: ${user.role}`,
          usuarioEliminado: user.username,
          rolEliminado: user.role
        }
      );

      const result = await this.usersRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException('Usuario no encontrado');
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error eliminando usuario');
    }
  }

  async softRemove(id: string, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      user.isActive = false;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);

      // 👇 CORREGIDO: Extraer el usuario correctamente
      let usuarioActualizado: User;
      if (Array.isArray(savedUser)) {
        usuarioActualizado = savedUser[0];
        if (!usuarioActualizado) {
          throw new InternalServerErrorException('Error: No se pudo eliminar el usuario');
        }
      } else {
        usuarioActualizado = savedUser;
      }

      // 👇 REGISTRAR EN BITÁCORA
      const usuarioModificador = updatedBy ? await this.findById(updatedBy) : null;
      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        usuarioModificador,
        null,
        {
          detalles: `Usuario desactivado (soft delete): ${user.username}`,
          usuarioEditado: user.username,
          accion: 'SOFT_DELETE'
        }
      );

      return new UserResponseDto(usuarioActualizado);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error eliminando usuario (soft delete)');
    }
  }

  // 📊 STATISTICS
  async getUsersStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    byRole: Record<UserRole, number>;
  }> {
    try {
      const total = await this.usersRepository.count();
      const active = await this.usersRepository.count({ where: { isActive: true } });
      const inactive = await this.usersRepository.count({ where: { isActive: false } });

      const byRole = {} as Record<UserRole, number>;
      for (const role of Object.values(UserRole)) {
        byRole[role] = await this.usersRepository.count({
          where: { role, isActive: true }
        });
      }

      return { total, active, inactive, byRole };
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo estadísticas de usuarios');
    }
  }

  async getUsersByRole(role: UserRole): Promise<UserResponseDto[]> {
    try {
      const users = await this.usersRepository.find({
        where: { role, isActive: true },
        order: { createdAt: 'DESC' }
      });
      return users.map(user => new UserResponseDto(user));
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo usuarios por rol');
    }
  }

  // 👇 MÉTODOS PARA SUPERVISORES
  async getSupervisores(): Promise<User[]> {
    try {
      const supervisores = await this.usersRepository.find({
        where: { 
          role: UserRole.SUPERVISOR,
          isActive: true 
        },
        order: { fullName: 'ASC' },
        select: ['id', 'fullName', 'username', 'email', 'role']
      });
      return supervisores;
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo supervisores');
    }
  }

  async getSupervisoresSimple(): Promise<{ id: string; nombre: string; username: string }[]> {
    try {
      const supervisores = await this.usersRepository.find({
        where: { 
          role: UserRole.SUPERVISOR,
          isActive: true 
        },
        order: { fullName: 'ASC' },
        select: ['id', 'fullName', 'username']
      });
      
      return supervisores.map(supervisor => ({
        id: supervisor.id,
        nombre: supervisor.fullName,
        username: supervisor.username
      }));
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo supervisores');
    }
  }

  // 🔐 TWO FACTOR & PASSWORD RESET METHODS
  async updateTwoFactorCode(userId: string, code: string, expires: Date): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        twoFactorCode: code,
        twoFactorExpires: expires,
        twoFactorAttempts: 0
      });
    } catch (error) {
      throw new InternalServerErrorException('Error actualizando código 2FA');
    }
  }

  async updateTwoFactorAttempts(userId: string, attempts: number): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        twoFactorAttempts: attempts
      });
    } catch (error) {
      throw new InternalServerErrorException('Error actualizando intentos 2FA');
    }
  }

  async clearTwoFactorCode(userId: string): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        twoFactorCode: undefined,
        twoFactorExpires: undefined,
        twoFactorAttempts: 0
      });
    } catch (error) {
      throw new InternalServerErrorException('Error limpiando código 2FA');
    }
  }

  async updateResetToken(userId: string, resetToken: string, resetTokenExpires: Date): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        resetToken,
        resetTokenExpires,
        updatedAt: new Date()
      });
    } catch (error) {
      throw new InternalServerErrorException('Error actualizando token de reset');
    }
  }

  async findByResetToken(resetToken: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({
        where: { resetToken }
      });
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuario por reset token');
    }
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await this.usersRepository.update(userId, {
        password: hashedPassword,
        updatedAt: new Date()
      });
    } catch (error) {
      throw new InternalServerErrorException('Error actualizando contraseña');
    }
  }

  async clearResetToken(userId: string): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        resetToken: undefined,
        resetTokenExpires: undefined,
        updatedAt: new Date()
      });
    } catch (error) {
      throw new InternalServerErrorException('Error limpiando token de reset');
    }
  }

  async findById(id: string, relations: string[] = []): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({
        where: { id },
        relations: relations
      });
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuario por ID');
    }
  }
}