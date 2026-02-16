// users/entities/user.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  BeforeInsert, 
  BeforeUpdate,
  OneToOne // 👈 IMPORTAR ESTO
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { Exclude } from 'class-transformer';
import { Signature } from '../../signatures/entities/signature.entity'; // 👈 IMPORTAR

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true, length: 100 })
  email: string;

  @Column({ name: 'full_name', length: 100 })
  fullName: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.RADICADOR
  })
  role: UserRole;

  @Exclude()
  @Column()
  password: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'two_factor_code', nullable: true })
  twoFactorCode?: string;

  @Column({ name: 'two_factor_expires', nullable: true })
  twoFactorExpires?: Date;

  @Column({ name: 'two_factor_attempts', default: 0 })
  twoFactorAttempts: number;

  @Column({ name: 'reset_token', nullable: true })
  resetToken?: string;

  @Column({ name: 'reset_token_expires', nullable: true })
  resetTokenExpires?: Date;

  // 👇 RELACIÓN CON FIRMA (UNA SOLA POR USUARIO)
  @OneToOne(() => Signature, signature => signature.user, {
    nullable: true,
    cascade: true
  })
  signature?: Signature;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.email) {
      this.email = this.email.toLowerCase().trim();
    }
    if (this.username) {
      this.username = this.username.toLowerCase().trim();
    }
    if (this.fullName) {
      this.fullName = this.fullName.trim();
    }
  }
}