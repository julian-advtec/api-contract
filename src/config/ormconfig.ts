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
import { DocumentoContratista } from 'src/contratista/entities/documento-contratista.entity';

// 🔥 DETECCIÓN AUTOMÁTICA
const isProduction = process.env.NODE_ENV === 'production';
const hasDatabaseUrl = !!process.env.DATABASE_URL;

export const ormconfig: DataSourceOptions = {
  type: 'postgres',

  ...(hasDatabaseUrl
    ? {
        // ☁️ RENDER
        url: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        // 🖥️ LOCAL / SERVIDOR INTERNO (TU CONFIG ORIGINAL)
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || 'password',
        database: process.env.DB_NAME || 'contract_db',
      }),

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
    RendicionCuentasHistorial,
    DocumentoContratista,
  ],

  synchronize: !isProduction,
  logging: !isProduction,
};

export const AppDataSource = new DataSource(ormconfig);