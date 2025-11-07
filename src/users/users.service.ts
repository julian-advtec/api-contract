import { Injectable, ConflictException } from '@nestjs/common';
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
    return this.usersRepository.findOne({ where: { username } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async create(userData: { username: string; password: string; email: string; role: UserRole }): Promise<User> {
    const existingUser = await this.findByUsername(userData.username);
    if (existingUser) {
      throw new ConflictException('El usuario ya existe');
    }

    const existingEmail = await this.findByEmail(userData.email);
    if (existingEmail) {
      throw new ConflictException('El email ya está registrado');
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);
    
    const user = this.usersRepository.create({
      ...userData,
      password: hashedPassword,
    });

    return this.usersRepository.save(user);
  }

  async updateTwoFactorCode(userId: string, code: string, expires: Date): Promise<void> {
    await this.usersRepository.update(userId, {
      twoFactorCode: code,
      twoFactorExpires: expires,
    });
  }

  
  async clearTwoFactorCode(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      twoFactorCode: null as any, // ✅ Usar null en lugar de undefined
      twoFactorExpires: null as any,
    });
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }
}