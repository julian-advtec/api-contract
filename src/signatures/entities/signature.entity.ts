// signatures/entities/signature.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn,
  OneToOne,
  JoinColumn 
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('signatures')
export class Signature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @OneToOne(() => User, user => user.signature)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: ['image', 'pdf']
  })
  type: 'image' | 'pdf';

  @Column('text', { name: 'encrypted_data' })
  encryptedData: string;

  @Column({ name: 'mime_type', length: 50 })
  mimeType: string;

  @Column({ name: 'file_size' })
  fileSize: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}