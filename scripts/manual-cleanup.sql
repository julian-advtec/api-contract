-- MANUAL CLEANUP SCRIPT - WINDOWS VERSION
-- ============================================
-- Ejecutar con: type scripts\manual-cleanup.sql | psql -U postgres -d contract_db

-- 1. Si existe la tabla users, eliminar todos los datos
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        -- Primero hacer username nullable temporalmente
        ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
        
        -- Eliminar todos los datos
        TRUNCATE TABLE users CASCADE;
        
        -- Volver a hacer username NOT NULL
        ALTER TABLE users ALTER COLUMN username SET NOT NULL;
        
        -- Agregar unique constraint si no existe
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'UQ_fe0bb3f6520ee0469504521e710'
        ) THEN
            ALTER TABLE users ADD CONSTRAINT UQ_fe0bb3f6520ee0469504521e710 UNIQUE (username);
        END IF;
        
        RAISE NOTICE 'Table users cleaned successfully';
    ELSE
        RAISE NOTICE 'Table users does not exist yet';
    END IF;
END $$;

-- 2. Verificar estado
SELECT 
    'users' as table_name,
    EXISTS(SELECT FROM pg_tables WHERE tablename = 'users') as exists,
    (SELECT COUNT(*) FROM users) as row_count;