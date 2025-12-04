import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';
import { UserRole } from './enums/user-role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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

  async findById(id: string): Promise<User | null> {
    try {
      return await this.usersRepository.findOne({ where: { id } });
    } catch (error) {
      throw new InternalServerErrorException('Error buscando usuario por ID');
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
        ...createUserDto,
        password: hashedPassword,
        isActive: createUserDto.isActive ?? true
      };

      // Solo agregar createdBy si se proporciona
      if (createdBy) {
        userData.createdBy = createdBy;
      }

      const user = this.usersRepository.create(userData);
      const savedUser = await this.usersRepository.save(user);
      return new UserResponseDto(savedUser);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new InternalServerErrorException('Error creando usuario');
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
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
      if (updateUserDto.password) {
        updateUserDto.password = await bcrypt.hash(updateUserDto.password, 12);
      }

      const updateData: any = {
        id,
        ...updateUserDto,
        updatedAt: new Date()
      };

      // Solo agregar updatedBy si se proporciona
      if (updatedBy) {
        updateData.updatedBy = updatedBy;
      }

      const updatedUser = await this.usersRepository.preload(updateData);

      if (!updatedUser) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const savedUser = await this.usersRepository.save(updatedUser);
      return new UserResponseDto(savedUser);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error actualizando usuario');
    }
  }

  // 🚀 STATUS MANAGEMENT
  async toggleUserStatus(id: string, updatedBy?: string): Promise<UserResponseDto> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      user.isActive = !user.isActive;
      user.updatedAt = new Date();

      // Solo asignar si existe
      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);
      return new UserResponseDto(savedUser);
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

      user.isActive = true;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);
      return new UserResponseDto(savedUser);
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

      user.isActive = false;
      user.updatedAt = new Date();

      if (updatedBy) {
        user.updatedBy = updatedBy;
      }

      const savedUser = await this.usersRepository.save(user);
      return new UserResponseDto(savedUser);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error desactivando usuario');
    }
  }

  // 🗑️ DELETE METHODS
  async remove(id: string): Promise<void> {
    try {
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
      return new UserResponseDto(savedUser);
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
      // ✅ CORREGIDO: usar usersRepository en lugar de usersService
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

  
}