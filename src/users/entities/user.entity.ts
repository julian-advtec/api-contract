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

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.RADICADOR
  })
  role: UserRole;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ default: false, name: 'is_email_verified' })
  isEmailVerified: boolean;

  @Column({ nullable: true, name: 'email_verification_code' })
  emailVerificationCode: string;

  @Column({ nullable: true, name: 'two_factor_code' })
  twoFactorCode: string;

  @Column({ type: 'timestamp', nullable: true, name: 'two_factor_expires' })
  twoFactorExpires: Date;

  @Column({ default: 0, name: 'two_factor_attempts' })
  twoFactorAttempts: number;

  @Column({ nullable: true, name: 'reset_token' })
  resetToken: string;

  @Column({ type: 'timestamp', nullable: true, name: 'reset_token_expires' })
  resetTokenExpires: Date;

  @Column({ nullable: true, name: 'created_by' })
  createdBy: string;

  @Column({ nullable: true, name: 'updated_by' })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}