// src/migrations/XXXXXXXXXXXXXX-UpdateContratistasTable.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateContratistasTable implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Renombrar nombre_completo a razon_social si existe
        await queryRunner.query(`
            DO $$ 
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_name = 'contratistas' AND column_name = 'nombre_completo') THEN
                    ALTER TABLE contratistas RENAME COLUMN nombre_completo TO razon_social;
                END IF;
            END $$;
        `);

        // 2. Asegurar que no hay NULL en documento_identidad
        await queryRunner.query(`
            UPDATE contratistas 
            SET documento_identidad = 'SIN_DOCUMENTO_' || id::text 
            WHERE documento_identidad IS NULL;
        `);

        // 3. Hacer documento_identidad NOT NULL
        await queryRunner.query(`
            ALTER TABLE contratistas ALTER COLUMN documento_identidad SET NOT NULL;
        `);

        // 4. Hacer razon_social NOT NULL
        await queryRunner.query(`
            UPDATE contratistas SET razon_social = 'Contratista sin nombre' 
            WHERE razon_social IS NULL OR razon_social = '';
            ALTER TABLE contratistas ALTER COLUMN razon_social SET NOT NULL;
        `);

        // 5. Agregar columnas nuevas si no existen
        await queryRunner.query(`
            ALTER TABLE contratistas 
            ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(10) DEFAULT 'CC',
            ADD COLUMN IF NOT EXISTS representante_legal VARCHAR(200),
            ADD COLUMN IF NOT EXISTS documento_representante VARCHAR(20),
            ADD COLUMN IF NOT EXISTS departamento VARCHAR(50),
            ADD COLUMN IF NOT EXISTS ciudad VARCHAR(50),
            ADD COLUMN IF NOT EXISTS tipo_contratista VARCHAR(50);
        `);

        // 6. Configurar tipo_documento
        await queryRunner.query(`
            UPDATE contratistas SET tipo_documento = 'CC' WHERE tipo_documento IS NULL;
            ALTER TABLE contratistas ALTER COLUMN tipo_documento SET NOT NULL;
        `);

        // 7. Eliminar columna antigua si existe
        await queryRunner.query(`
            ALTER TABLE contratistas DROP COLUMN IF EXISTS "tipoContratista";
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revertir cambios si es necesario
        await queryRunner.query(`
            ALTER TABLE contratistas 
            DROP COLUMN IF EXISTS tipo_documento,
            DROP COLUMN IF EXISTS representante_legal,
            DROP COLUMN IF EXISTS documento_representante,
            DROP COLUMN IF EXISTS departamento,
            DROP COLUMN IF EXISTS ciudad,
            DROP COLUMN IF EXISTS tipo_contratista;
        `);
        
        await queryRunner.query(`
            ALTER TABLE contratistas ALTER COLUMN documento_identidad DROP NOT NULL;
        `);
        
        await queryRunner.query(`
            ALTER TABLE contratistas RENAME COLUMN razon_social TO nombre_completo;
        `);
    }
}