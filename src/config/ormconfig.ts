// src/config/ormconfig.ts
import { DataSource, DataSourceOptions } from 'typeorm';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { Contratista } from '../contratista/entities/contratista.entity';
import { SupervisorDocumento } from '../supervision/entities/supervisor.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';
import { ContabilidadDocumento } from '../contabilidad/entities/contabilidad-documento.entity';
import { TesoreriaDocumento } from '../tesoreria/entities/tesoreria-documento.entity';
import { Signature } from '../signatures/entities/signature.entity';
import { AsesorGerenciaDocumento } from '../asesor-gerencia/entities/asesor-gerencia-documento.entity';
import { RendicionCuentasDocumento } from '../rendicion-cuentas/entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from '../rendicion-cuentas/entities/rendicion-cuentas-historial.entity';
import { DocumentoContratista } from '../contratista/entities/documento-contratista.entity';
import { BitacoraSistema } from '../bitacora-sistema/entities/bitacora-sistema.entity';

import { Contrato } from '../juridica/entities/contrato.entity';
import { Proveedor } from '../juridica/entities/proveedor.entity';
import { Poliza } from '../juridica/entities/poliza.entity';
import { ModificacionContrato } from '../juridica/entities/modificacion-contrato.entity';
import { DocumentoContrato } from '../juridica/entities/documento-contrato.entity';
import { Obligacion } from '../juridica/entities/obligacion.entity';

import { FormularioPublico } from '../contratista/entities/formulario-publico.entity';
import { DocumentoFormularioPublico } from '../contratista/entities/documento-formulario-publico.entity';

// Función para detectar si estamos en producción
function isProductionEnvironment(): boolean {
    // Detectar si estamos en Render
    const isRender = process.env.RENDER !== undefined ||
        (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com'));

    // Detectar por NODE_ENV
    const isProd = process.env.NODE_ENV === 'production';

    // Detectar archivo .env.production
    const hasProductionEnv = fs.existsSync(path.join(process.cwd(), '.env.production'));

    // Detectar si hay DATABASE_URL de producción (Render o Supabase)
    const hasProdDbUrl = process.env.DATABASE_URL &&
        (process.env.DATABASE_URL.includes('render.com') ||
            process.env.DATABASE_URL.includes('supabase.co'));

    // Detectar si estamos en VSCode (desarrollo)
    const isVSCode = process.env.VSCODE_PID !== undefined;

    // Si estamos en VSCode, forzar desarrollo
    if (isVSCode) {
        console.log('💻 VSCode detectado - Forzando entorno DESARROLLO');
        return false;
    }

    // Si hay archivo .env.production, es producción
    if (hasProductionEnv) {
        console.log('📁 Archivo .env.production detectado - Entorno PRODUCCIÓN');
        return true;
    }

    // Si estamos en Render, es producción
    if (isRender) {
        console.log('☁️ Render.com detectado - Entorno PRODUCCIÓN');
        return true;
    }

    // Si NODE_ENV es production, es producción
    if (isProd) {
        console.log('🔧 NODE_ENV=production - Entorno PRODUCCIÓN');
        return true;
    }

    // Si hay DATABASE_URL de producción, es producción
    if (hasProdDbUrl) {
        console.log('🗄️ DATABASE_URL de producción detectada - Entorno PRODUCCIÓN');
        return true;
    }

    // Por defecto, desarrollo
    console.log('💻 Entorno DESARROLLO por defecto');
    return false;
}

// Función para detectar configuración de base de datos
function detectDatabaseConfig() {
    const isProduction = isProductionEnvironment();

    console.log('🔍 ========== CONFIGURACIÓN BASE DE DATOS ==========');
    console.log(`   📝 Entorno: ${isProduction ? 'PRODUCCIÓN' : 'DESARROLLO'}`);
    console.log(`   📝 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   📝 DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Presente' : '❌ No presente'}`);
    console.log(`   📝 DB_HOST: ${process.env.DB_HOST || 'No configurado'}`);

    // ENTORNO DE PRODUCCIÓN
    if (isProduction) {
        // Prioridad 1: DATABASE_URL (Render/Supabase)
        if (process.env.DATABASE_URL) {
            console.log('☁️ Usando DATABASE_URL para conexión (PRODUCCIÓN)');
            return {
                url: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false,
                },
            };
        }

        // Prioridad 2: Configuración individual en producción (fallback)
        if (process.env.DB_HOST) {
            console.log('⚠️ Usando configuración individual como fallback (PRODUCCIÓN)');
            return {
                host: process.env.DB_HOST,
                port: parseInt(process.env.DB_PORT || '5432', 10),
                username: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASS || 'postgres',
                database: process.env.DB_NAME || 'contract_db',
            };
        }

        // Si no hay configuración, error
        console.error('❌ No hay configuración de base de datos para producción');
        throw new Error('Database configuration missing for production');
    }

    // ENTORNO DE DESARROLLO - Usar base de datos LOCAL
    console.log('💾 Usando base de datos LOCAL (DESARROLLO)');
    return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || '132754JU9011', // Tu contraseña local
        database: process.env.DB_NAME || 'contract_db',
    };
}

const isProduction = isProductionEnvironment();
const dbConfig = detectDatabaseConfig();

console.log('✅ Configuración final de base de datos:');
if (dbConfig.hasOwnProperty('url')) {
    console.log(`   📍 URL: ${(dbConfig as any).url.substring(0, 50)}...`);
} else {
    console.log(`   📍 Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   📍 Base de datos: ${dbConfig.database}`);
    console.log(`   📍 Usuario: ${dbConfig.username}`);
}
console.log('==================================================');

export const ormconfig: DataSourceOptions = {
    type: 'postgres',
    ...dbConfig,
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
        BitacoraSistema,
        // ✅ ADD THE NEW ENTITIES HERE
        FormularioPublico,
        DocumentoFormularioPublico,
        // Jurídica
        Contrato,
        Proveedor,
        Poliza,
        ModificacionContrato,
        DocumentoContrato,
        Obligacion,
    ],
    synchronize: false,
    logging: ['error', 'warn'],
    extra: {
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    },
};

export const AppDataSource = new DataSource(ormconfig);