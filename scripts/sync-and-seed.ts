// scripts/sync-and-seed.ts
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { ormconfig } from '../src/config/ormconfig';

async function syncAndSeed() {
  console.log('🚀 Iniciando sincronización de tablas + seed...');

  const dataSource = new DataSource(ormconfig);

  try {
    await dataSource.initialize();
    console.log('✅ Conectado correctamente a PostgreSQL (Render)');

    // === FORZAR CREACIÓN DE TABLAS ===
    console.log('🔄 Ejecutando synchronize(false)...');
    await dataSource.synchronize(false);
    console.log('✅ Esquema sincronizado - Tablas creadas/actualizadas');

    const userRepo = dataSource.getRepository(User);

    // Crear usuario admin si no existe
    const existing = await userRepo.findOne({ where: { username: 'sistemas2' } });

    if (!existing) {
      console.log('🌱 Creando usuario administrador...');
      const hashed = await bcrypt.hash('sistemas123', 12);

      const admin = userRepo.create({
        username: 'sistemas2',
        email: 'prueba2fa@lamaria.gov.co',
        password: hashed,
        role: 'admin' as UserRole,
        fullName: 'Administrador del Sistema',
        isActive: true,
        isEmailVerified: true,
        createdBy: 'system_seed'
      });

      await userRepo.save(admin);
      console.log('✅ Usuario ADMIN creado: sistemas2 / sistemas123');
    } else {
      console.log('👤 El usuario sistemas2 ya existe');
    }

    const total = await userRepo.count();
    console.log(`📊 Total usuarios en BD: ${total}`);

    console.log('\n🎉 ¡Todo listo! Las tablas ya deberían existir.');

  } catch (error: any) {
    console.error('❌ Error grave:', error.message);
    if (error.code) console.error('Código:', error.code);
    if (error.detail) console.error('Detalle:', error.detail);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Conexión cerrada');
    }
  }
}

syncAndSeed().catch(err => {
  console.error('❌ Error fuera del try/catch:', err);
  process.exit(1);
});