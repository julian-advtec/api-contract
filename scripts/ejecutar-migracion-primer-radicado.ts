// scripts/ejecutar-migracion-primer-radicado.ts
import 'dotenv/config';

console.log('🚀 EJECUTANDO MIGRACIÓN PARA PRIMER RADICADO DEL AÑO');
console.log('==================================================');

async function ejecutarTodo() {
    try {
        // 1. Ejecutar migración TypeORM (si tienes migraciones configuradas)
        console.log('\n📦 Paso 1: Verificando migración TypeORM...');
        const { execSync } = require('child_process');
        
        try {
            // Primero verificar si necesitas crear una migración
            console.log('🔍 Verificando si la columna ya existe...');
            
            // Ejecutar SQL directamente
            const { Client } = require('pg');
            const client = new Client({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASS || 'password',
                database: process.env.DB_NAME || 'contract_db',
            });
            
            await client.connect();
            
            // Verificar si la columna existe
            const result = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'documentos' 
                AND column_name = 'primer_radicado_ano'
            `);
            
            if (result.rows.length === 0) {
                console.log('➕ La columna no existe, agregándola...');
                await client.query(`
                    ALTER TABLE "documentos" 
                    ADD COLUMN "primer_radicado_ano" BOOLEAN NOT NULL DEFAULT false
                `);
                console.log('✅ Columna agregada exitosamente');
            } else {
                console.log('✅ La columna ya existe');
            }
            
            await client.end();
            
        } catch (error) {
            console.log('⚠️ Error verificando/agregando columna:', error.message);
            console.log('ℹ️ Continuando con el script de marcado...');
        }
        
        // 2. Ejecutar script de verificación
        console.log('\n🔍 Paso 2: Verificando y corrigiendo marcas...');
        const { marcarPrimerosRadicados } = require('./marcar-primeros-radicados.ts');
        await marcarPrimerosRadicados();
        
        console.log('\n🎉 TODOS LOS PASOS COMPLETADOS EXITOSAMENTE');
        
    } catch (error) {
        console.error('❌ Error en el proceso:', error);
        process.exit(1);
    }
}

// Ejecutar
ejecutarTodo();