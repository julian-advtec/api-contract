// src/contratista/entities/token-usado.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('tokens_usados')
export class TokenUsado {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'token', unique: true })
    token: string;

    @Column({ name: 'contratista_id' })
    contratistaId: string;

    @Column({ name: 'formulario_id', nullable: true })
    formularioId: string;

    @CreateDateColumn({ name: 'fecha_uso' })
    fechaUso: Date;
}