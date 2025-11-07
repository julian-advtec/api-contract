import { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity'; // ✅ Ruta corregida
import 'dotenv/config';

export const ormconfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [User],
  synchronize: true,
  logging: true,
};