import { MigrationInterface, QueryRunner } from "typeorm";

export class FixContabilidadEnum1770900913022 implements MigrationInterface {
  name = 'FixContabilidadEnum1770900913022'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear el nuevo tipo de enum temporal con los valores SIMPLIFICADOS
    await queryRunner.query(`
      CREATE TYPE "contabilidad_documentos_estado_enum_new" AS ENUM (
        'DISPONIBLE', 
        'EN_REVISION', 
        'OBSERVADO', 
        'RECHAZADO', 
        'GLOSADO', 
        'COMPLETADO', 
        'PROCESADO'
      );
    `);

    // 2. Alterar la columna "estado" para usar el nuevo enum + conversión explícita de valores viejos
    await queryRunner.query(`
      ALTER TABLE "contabilidad_documentos"
      ALTER COLUMN "estado" TYPE "contabilidad_documentos_estado_enum_new"
      USING (
        CASE "estado"::text
          WHEN 'EN_REVISION_CONTABILIDAD' THEN 'EN_REVISION'
          WHEN 'OBSERVADO_CONTABILIDAD'   THEN 'OBSERVADO'
          WHEN 'RECHAZADO_CONTABILIDAD'   THEN 'RECHAZADO'
          WHEN 'GLOSADO_CONTABILIDAD'     THEN 'GLOSADO'
          WHEN 'COMPLETADO_CONTABILIDAD'  THEN 'COMPLETADO'
          WHEN 'PROCESADO_CONTABILIDAD'   THEN 'PROCESADO'
          ELSE 'DISPONIBLE'  -- fallback seguro para cualquier valor inesperado
        END
      )::"contabilidad_documentos_estado_enum_new";
    `);

    // 3. Eliminar el enum viejo
    await queryRunner.query(`DROP TYPE "contabilidad_documentos_estado_enum";`);

    // 4. Renombrar el nuevo enum al nombre original (para que coincida con la entidad)
    await queryRunner.query(`
      ALTER TYPE "contabilidad_documentos_estado_enum_new" 
      RENAME TO "contabilidad_documentos_estado_enum";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback opcional (si necesitas revertir la migración)
    await queryRunner.query(`
      CREATE TYPE "contabilidad_documentos_estado_enum_old" AS ENUM (
        'DISPONIBLE', 
        'EN_REVISION_CONTABILIDAD', 
        'OBSERVADO_CONTABILIDAD', 
        'RECHAZADO_CONTABILIDAD', 
        'GLOSADO_CONTABILIDAD', 
        'COMPLETADO_CONTABILIDAD', 
        'PROCESADO_CONTABILIDAD'
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "contabilidad_documentos"
      ALTER COLUMN "estado" TYPE "contabilidad_documentos_estado_enum_old"
      USING (
        CASE "estado"::text
          WHEN 'EN_REVISION' THEN 'EN_REVISION_CONTABILIDAD'
          WHEN 'OBSERVADO'   THEN 'OBSERVADO_CONTABILIDAD'
          WHEN 'RECHAZADO'   THEN 'RECHAZADO_CONTABILIDAD'
          WHEN 'GLOSADO'     THEN 'GLOSADO_CONTABILIDAD'
          WHEN 'COMPLETADO'  THEN 'COMPLETADO_CONTABILIDAD'
          WHEN 'PROCESADO'   THEN 'PROCESADO_CONTABILIDAD'
          ELSE 'DISPONIBLE'
        END
      )::"contabilidad_documentos_estado_enum_old";
    `);

    await queryRunner.query(`DROP TYPE "contabilidad_documentos_estado_enum";`);

    await queryRunner.query(`
      ALTER TYPE "contabilidad_documentos_estado_enum_old" 
      RENAME TO "contabilidad_documentos_estado_enum";
    `);
  }
}