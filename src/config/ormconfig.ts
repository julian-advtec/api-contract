import { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
// ✅ Comentar hasta que las entidades estén correctas
// import { Contratista } from '../radicacion/entities/contratista.entity';
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
    // ✅ Agregar cuando estén corregidas
    // Contratista,
    // RegistroAcceso
  ],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
};