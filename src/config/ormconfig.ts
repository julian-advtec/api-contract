// src/config/ormconfig.ts
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { Contratista } from '../contratista/entities/contratista.entity';
import { SupervisorDocumento } from '../supervision/entities/supervisor.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';
import { ContabilidadDocumento } from '../contabilidad/entities/contabilidad-documento.entity';
import 'dotenv/config';
import { TesoreriaDocumento } from 'src/tesoreria/entities/tesoreria-documento.entity';
import { Signature } from 'src/signatures/entities/signature.entity';
import { AsesorGerenciaDocumento } from 'src/asesor-gerencia/entities/asesor-gerencia-documento.entity';

// Opciones de configuración
export const ormconfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'password',
  database: process.env.DB_NAME || 'contract_db',
  
  // ✅ LISTA COMPLETA DE ENTIDADES
  entities: [
    User, 
    Documento,
    Contratista,
    SupervisorDocumento,
    AuditorDocumento,
    ContabilidadDocumento,
    TesoreriaDocumento,
    Signature,
    AsesorGerenciaDocumento

  ],
  
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  
  // Opciones adicionales para PostgreSQL
  extra: {
    trustServerCertificate: true,
  },
};

// DataSource para TypeORM CLI
export const AppDataSource = new DataSource(ormconfig);