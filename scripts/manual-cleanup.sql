-- 1. Primero hacer la columna nullable
ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;

-- 2. Agregar la columna si no existe
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'full_name') THEN
        ALTER TABLE users ADD COLUMN full_name VARCHAR;
    END IF;
END $$;

-- 3. Actualizar datos existentes con valor por defecto
UPDATE users SET full_name = username WHERE full_name IS NULL OR full_name = '';

-- 4. Ahora sí hacerla NOT NULL
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;

-- 5. Limpiar la tabla completamente (OJO: Esto borra todos los datos)
-- TRUNCATE TABLE users CASCADE;