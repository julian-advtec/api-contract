// src/config/ormconfig.ts
import { DataSource, DataSourceOptions } from 'typeorm';
import 'dotenv/config';

import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { Contratista } from '../contratista/entities/contratista.entity';
import { SupervisorDocumento } from '../supervision/entities/supervisor.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';
import { ContabilidadDocumento } from '../contabilidad/entities/contabilidad-documento.entity';
import { TesoreriaDocumento } from '../tesoreria/entities/tesoreria-documento.entity';
import { Signature } from '../signatures/entities/signature.entity';
import { AsesorGerenciaDocumento } from '../asesor-gerencia/entities/asesor-gerencia-documento.entity';
import { RendicionCuentasDocumento } from 'src/rendicion-cuentas/entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from 'src/rendicion-cuentas/entities/rendicion-cuentas-historial.entity';

export const ormconfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'password',
  database: process.env.DB_NAME || 'contract_db',

  entities: [
    User,
    Documento,
    Contratista,
    SupervisorDocumento,
    AuditorDocumento,
    ContabilidadDocumento,
    TesoreriaDocumento,
    Signature,
    AsesorGerenciaDocumento,
    RendicionCuentasDocumento,
    RendicionCuentasHistorial
  ],

  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',

  extra: {
    trustServerCertificate: true,
  },
};

// DataSource para scripts / CLI
export const AppDataSource = new DataSource(ormconfig);