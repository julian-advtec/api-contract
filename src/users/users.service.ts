import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
  ) {}

  async create(username: string, password: string) {
    const exists = await this.repo.findOne({ where: { username } });
    if (exists) throw new Error('Usuario ya existe');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.repo.create({ username, password: passwordHash });
    return this.repo.save(user);
  }

  async createAdmin() {
    const adminExists = await this.repo.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      const admin = this.repo.create({
        username: 'admin',
        password: passwordHash,
        role: UserRole.ADMIN,
      });
      await this.repo.save(admin);
      console.log('✅ Usuario admin creado por defecto');
    }
  }

  async findByUsername(username: string) {
    return this.repo.findOne({ where: { username } });
  }

  async createVisita() {
    const visitaExists = await this.repo.findOne({ where: { username: 'visita' } });
    if (!visitaExists) {
      const passwordHash = await bcrypt.hash('visita123', 10);
      const visita = this.repo.create({
        username: 'visita',
        password: passwordHash,
        role: UserRole.VISITA,
      });
      await this.repo.save(visita);
      console.log('👥 Usuario visita creado');
    }
  }

  async findAll(): Promise<User[]> {
    return this.repo.find();
  }

  async findOne(username: string): Promise<User | null> {
    return this.repo.findOne({ where: { username } });
  }
}
