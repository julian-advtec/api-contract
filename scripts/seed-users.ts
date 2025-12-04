import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { ormconfig } from '../src/config/ormconfig';

interface UserSeed {
  username: string;
  email: string;
  password: string;
  role: UserRole;
  fullName: string;
}

const usersToSeed: UserSeed[] = [
  {
    username: 'sistemas2',
    email: 'prueba2fa@lamaria.gov.co',
    password: 'sistemas123',
    role: UserRole.ADMIN,
    fullName: 'Administrador del Sistema'
  },
  {
    username: 'prueba2fa',
    email: 'sistemas2@lamaria.gov.co',
    password: 'prueba123',
    role: UserRole.RADICADOR,
    fullName: 'Usuario Prueba 2FA'
  },
  {
    username: 'radicador1',
    email: 'radicador1@contratos.com',
    password: 'radicador123',
    role: UserRole.RADICADOR,
    fullName: 'Radicador Principal'
  },
  {
    username: 'supervisor1',
    email: 'supervisor1@contratos.com',
    password: 'supervisor123',
    role: UserRole.SUPERVISOR,
    fullName: 'Supervisor General'
  },
  {
    username: 'auditor1',
    email: 'auditor1@contratos.com',
    password: 'auditor123',
    role: UserRole.AUDITOR_CUENTAS,
    fullName: 'Auditor de Cuentas'
  },
  {
    username: 'contabilidad1',
    email: 'contabilidad1@contratos.com',
    password: 'contabilidad123',
    role: UserRole.CONTABILIDAD,
    fullName: 'Contabilidad Principal'
  },
  {
    username: 'tesoreria1',
    email: 'tesoreria1@contratos.com',
    password: 'tesoreria123',
    role: UserRole.TESORERIA,
    fullName: 'Tesorería General'
  },
  {
    username: 'asesor1',
    email: 'asesor1@contratos.com',
    password: 'asesor123',
    role: UserRole.ASESOR_GERENCIA,
    fullName: 'Asesor de Gerencia'
  },
  {
    username: 'rendicion1',
    email: 'rendicion1@contratos.com',
    password: 'rendicion123',
    role: UserRole.RENDICION_CUENTAS,
    fullName: 'Rendición de Cuentas'
  }
];

async function seedUsers() {
  const dataSource = new DataSource({
    ...ormconfig,
    synchronize: false, // ✅ Desactivar synchronize aquí también
  });
  
  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    const usersRepository = dataSource.getRepository(User);

    // 1. PRIMERO: Verificar si la tabla tiene datos
    const existingCount = await usersRepository.count();
    console.log(`📊 Usuarios existentes en BD: ${existingCount}`);

    if (existingCount > 0) {
      console.log('⚠️  La tabla ya tiene datos. Limpiando...');
      
      // Intentar TRUNCATE (más rápido)
      try {
        await dataSource.query('TRUNCATE TABLE users CASCADE');
        console.log('✅ Tabla limpiada con TRUNCATE');
      } catch (truncateError) {
        console.log('⚠️  TRUNCATE falló, usando DELETE...');
        await usersRepository.clear();
        console.log('✅ Tabla limpiada con DELETE');
      }
    }

    console.log('🌱 Creando nuevos usuarios...');

    for (const userData of usersToSeed) {
      // Crear usuario con contraseña hasheada
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      const user = usersRepository.create({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        role: userData.role,
        fullName: userData.fullName,
        isActive: true,
        isEmailVerified: true,
        createdBy: 'system'
      });

      await usersRepository.save(user);
      console.log(`✅ Usuario ${userData.username} (${userData.role}) creado`);
    }

    // Verificar usuarios creados
    const finalUsers = await usersRepository.find({
      select: ['id', 'username', 'email', 'role', 'fullName']
    });
    
    console.log(`\n📊 Total de usuarios en base de datos: ${finalUsers.length}`);
    console.log('\n👥 Usuarios creados:');
    finalUsers.forEach(user => {
      console.log(`   - ${user.username} (${user.role}) - ${user.email} - ${user.fullName}`);
    });

    console.log('\n🎉 Todos los usuarios han sido creados exitosamente!');
    console.log('\n📋 Credenciales de prueba:');
    console.log('👑 Admin (NO 2FA): sistemas2 / sistemas123');
    console.log('🧪 Prueba 2FA (envío real): prueba2fa / prueba123');
    console.log('📝 Radicador: radicador1 / radicador123');
    console.log('👀 Supervisor: supervisor1 / supervisor123');
    console.log('🔍 Auditor: auditor1 / auditor123');
    console.log('💰 Contabilidad: contabilidad1 / contabilidad123');
    console.log('🏦 Tesorería: tesoreria1 / tesoreria123');
    console.log('💼 Asesor: asesor1 / asesor123');
    console.log('📊 Rendición: rendicion1 / rendicion123');

  } catch (error) {
    console.error('❌ Error en el seed:', error);
    throw error;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('✅ Conexión cerrada');
    }
  }
}

// Ejecutar el script
seedUsers().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});