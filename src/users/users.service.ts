import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';
import { UserRole } from './enums/user-role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

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

  async create(userData: {
    username: string;
    password: string;
    email: string;
    role: UserRole;
  }): Promise<User> {
    try {
      const existingUser = await this.findByUsername(userData.username);
      if (existingUser) throw new ConflictException('El usuario ya existe');

      const existingEmail = await this.findByEmail(userData.email);
      if (existingEmail) throw new ConflictException('El email ya está registrado');

      const hashedPassword = await bcrypt.hash(userData.password, 12);

      const user = this.usersRepository.create({
        ...userData,
        password: hashedPassword,
      });

      return await this.usersRepository.save(user);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new InternalServerErrorException('Error creando usuario');
    }
  }

  async updateTwoFactorCode(userId: string, code: string, expires: Date): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        twoFactorCode: code,
        twoFactorExpires: expires,
      });
    } catch (error) {
      throw new InternalServerErrorException('Error actualizando código 2FA');
    }
  }

  async clearTwoFactorCode(userId: string): Promise<void> {
    try {
      await this.usersRepository.update(userId, {
        twoFactorCode: null,
        twoFactorExpires: null,
      });
    } catch (error) {
      throw new InternalServerErrorException('Error limpiando código 2FA');
    }
  }

  async findAll(): Promise<User[]> {
    try {
      return await this.usersRepository.find();
    } catch (error) {
      throw new InternalServerErrorException('Error obteniendo usuarios');
    }
  }
}