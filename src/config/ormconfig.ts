// src/config/ormconfig.ts
import { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
// ✅ DESCOMENTAR ESTAS LÍNEAS:
import { Contratista } from '../radicacion/entities/contratista.entity';
// import { RegistroAcceso } from '../radicacion/entities/registro-acceso.entity';
import 'dotenv/config';

export const ormconfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [
    User, 
    Documento,
    // ✅ DESCOMENTAR Y AGREGAR:
    Contratista,  // ← ¡QUITA EL COMENTARIO DE ESTA LÍNEA!
    // RegistroAcceso
  ],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
};