// scripts/create-admin.ts
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { ormconfig } from '../src/config/ormconfig';

async function createAdminUser() {
  const dataSource = new DataSource(ormconfig);
  
  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    const usersRepository = dataSource.getRepository(User);

    // Verificar si ya existe el admin
    const existingAdmin = await usersRepository.findOne({
      where: { username: 'admin' }
    });

    if (existingAdmin) {
      console.log('⚠️ El usuario admin ya existe');
      await dataSource.destroy();
      return;
    }

    // Crear usuario admin
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    const adminUser = usersRepository.create({
      username: 'admin',
      email: 'admin@contratos.com',
      password: hashedPassword,
      role: UserRole.ADMIN,
      isEmailVerified: true,
    });

    await usersRepository.save(adminUser);
    console.log('✅ Usuario admin creado exitosamente');
    console.log('📧 Email: admin@contratos.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Rol: ADMIN');

  } catch (error) {
    console.error('❌ Error creando usuario admin:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('✅ Conexión cerrada');
    }
  }
}

// Ejecutar el script
createAdminUser();