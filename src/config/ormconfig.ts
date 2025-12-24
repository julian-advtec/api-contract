import { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { Contratista } from '../radicacion/entities/contratista.entity';
import { SupervisorDocumento } from '../supervision/entities/supervisor.entity'; // ¡IMPORTANTE!
import 'dotenv/config';

export const ormconfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'password',
  database: process.env.DB_NAME || 'contract_db',
  
  // ✅ LISTA COMPLETA DE ENTIDADES (¡AGREGA SupervisorDocumento!)
  entities: [
    User, 
    Documento,
    Contratista,
    SupervisorDocumento, // ← ¡¡¡ESTO ES LO QUE FALTA!!!
  ],
  
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  
  // Opciones adicionales para PostgreSQL
  extra: {
    trustServerCertificate: true,
  },
};