// scripts/seed-users.ts
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { ormconfig } from '../src/config/ormconfig';

async function seedUsers() {
  console.log('🚀 Iniciando inicialización de base de datos + seed...');

  const dataSource = new DataSource(ormconfig);

  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    // === FORZAR CREACIÓN DE TABLAS (lo que te faltaba) ===
    console.log('🔄 Sincronizando esquema de base de datos (creando tablas)...');
    await dataSource.synchronize(false);   // false = no elimina datos existentes
    console.log('✅ Tablas creadas/actualizadas correctamente');

    const usersRepository = dataSource.getRepository(User);

    // Verificar si ya hay usuarios
    const existingCount = await usersRepository.count();
    console.log(`📊 Usuarios existentes: ${existingCount}`);

    if (existingCount > 0) {
      console.log('👤 Ya existen usuarios. Saltando creación automática.');
    } else {
      console.log('🌱 No hay usuarios. Creando usuarios de prueba...');

      const usersToSeed = [
        {
          username: 'sistemas2',
          email: 'prueba2fa@lamaria.gov.co',
          password: 'sistemas123',
          role: UserRole.ADMIN,
          fullName: 'Administrador del Sistema'
        },
        // ... puedes dejar los demás si quieres
      ];

      for (const userData of usersToSeed) {
        const hashedPassword = await bcrypt.hash(userData.password, 12);

        const user = usersRepository.create({
          username: userData.username.toLowerCase(),
          email: userData.email,
          password: hashedPassword,
          role: userData.role.toString().toLowerCase() as UserRole,
          fullName: userData.fullName,
          isActive: true,
          isEmailVerified: true,
          createdBy: 'system_seed'
        });

        await usersRepository.save(user);
        console.log(`✅ Usuario creado: ${userData.username} (${userData.role})`);
      }
    }

    // Mostrar usuarios finales
    const allUsers = await usersRepository.find({ select: ['username', 'email', 'role'] });
    console.log('\n👥 Usuarios en la BD:');
    allUsers.forEach(u => console.log(`   - ${u.username} | ${u.role}`));

    console.log('\n🎉 Inicialización completada!');
    console.log('🔑 Admin → username: sistemas2 | password: sistemas123');

  } catch (error: any) {
    console.error('\n❌ Error fatal:', error.message);
    if (error.query) console.error('Query:', error.query);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Conexión cerrada');
    }
  }
}

seedUsers().catch(err => {
  console.error('Error no manejado:', err);
  process.exit(1);
});