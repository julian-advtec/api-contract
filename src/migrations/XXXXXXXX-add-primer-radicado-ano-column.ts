// src/migrations/20250107-add-primer-radicado-ano-column.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrimerRadicadoAnoColumn20250107 implements MigrationInterface {
    name = 'AddPrimerRadicadoAnoColumn20250107'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Verificar si la columna ya existe
        const table = await queryRunner.getTable('documentos');
        const columnExists = table?.columns.find(col => col.name === 'primer_radicado_ano');
        
        if (!columnExists) {
            await queryRunner.query(`
                ALTER TABLE "documentos" 
                ADD COLUMN "primer_radicado_ano" BOOLEAN NOT NULL DEFAULT false
            `);
            
            console.log('✅ Columna "primer_radicado_ano" agregada');
        } else {
            console.log('⚠️ Columna "primer_radicado_ano" ya existe');
        }
        
        // Actualizar documentos existentes (primer radicado por año)
        console.log('🔄 Actualizando documentos existentes...');
        await queryRunner.query(`
            WITH primeros_por_ano AS (
                SELECT 
                    id,
                    numero_radicado,
                    fecha_radicacion,
                    SUBSTRING(numero_radicado FROM '^R(\d{4})-\d{3}$') as ano,
                    ROW_NUMBER() OVER (
                        PARTITION BY SUBSTRING(numero_radicado FROM '^R(\d{4})-\d{3}$') 
                        ORDER BY fecha_radicacion ASC
                    ) as rn
                FROM "documentos"
                WHERE numero_radicado ~ '^R\d{4}-\d{3}$'
            )
            UPDATE "documentos" d
            SET primer_radicado_ano = true
            FROM primeros_por_ano p
            WHERE d.id = p.id AND p.rn = 1
        `);
        
        const result = await queryRunner.query(`
            SELECT COUNT(*) as total_marcados 
            FROM "documentos" 
            WHERE primer_radicado_ano = true
        `);
        
        console.log(`✅ ${result[0]?.total_marcados || 0} documentos marcados como primeros del año`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "documentos" 
            DROP COLUMN "primer_radicado_ano"
        `);
    }
}