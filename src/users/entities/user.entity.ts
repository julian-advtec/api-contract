// En user.entity.ts - AGREGAR LAS NUEVAS PROPIEDADES
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '../enums/user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @Column({ unique: true })
  email: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.RADICADOR
  })
  role: UserRole;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ nullable: true })
  emailVerificationCode: string;

  @Column({ nullable: true })
  twoFactorCode: string;

  @Column({ type: 'timestamp', nullable: true })
  twoFactorExpires: Date;

  @Column({ default: 0 })
  twoFactorAttempts: number;

  // ✅ AGREGAR ESTAS NUEVAS PROPIEDADES
  @Column({ nullable: true })
  resetToken: string;

  @Column({ type: 'timestamp', nullable: true })
  resetTokenExpires: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}