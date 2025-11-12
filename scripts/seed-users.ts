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
}

const usersToSeed: UserSeed[] = [
  {
    username: 'sistemas2',
    email: 'prueba2fa@lamaria.gov.co', // 🔥 CORREO DIFERENTE PARA ADMIN
    password: 'sistemas123',
    role: UserRole.ADMIN
  },
  {
    username: 'prueba2fa',
    email: 'sistemas2@lamaria.gov.co', // 🔥 CORREO REAL PARA PRUEBA 2FA
    password: 'prueba123',
    role: UserRole.RADICADOR
  },
  {
    username: 'radicador1',
    email: 'radicador1@contratos.com',
    password: 'radicador123',
    role: UserRole.RADICADOR
  },
  {
    username: 'supervisor1',
    email: 'supervisor1@contratos.com',
    password: 'supervisor123',
    role: UserRole.SUPERVISOR
  },
  {
    username: 'auditor1',
    email: 'auditor1@contratos.com',
    password: 'auditor123',
    role: UserRole.AUDITOR_CUENTAS
  },
  {
    username: 'contabilidad1',
    email: 'contabilidad1@contratos.com',
    password: 'contabilidad123',
    role: UserRole.CONTABILIDAD
  },
  {
    username: 'tesoreria1',
    email: 'tesoreria1@contratos.com',
    password: 'tesoreria123',
    role: UserRole.TESORERIA
  },
  {
    username: 'asesor1',
    email: 'asesor1@contratos.com',
    password: 'asesor123',
    role: UserRole.ASESOR_GERENCIA
  },
  {
    username: 'rendicion1',
    email: 'rendicion1@contratos.com',
    password: 'rendicion123',
    role: UserRole.RENDICION_CUENTAS
  }
];

async function seedUsers() {
  const dataSource = new DataSource(ormconfig);
  
  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    const usersRepository = dataSource.getRepository(User);

    // 🔥 LIMPIAR PRIMERO TODOS LOS USUARIOS EXISTENTES
    console.log('🧹 Limpiando usuarios existentes...');
    await usersRepository.clear();
    console.log('✅ Todos los usuarios eliminados');

    console.log('🌱 Creando nuevos usuarios...');

    for (const userData of usersToSeed) {
      // Verificar si el usuario ya existe (aunque limpiamos, por seguridad)
      const existingUser = await usersRepository.findOne({
        where: [
          { username: userData.username },
          { email: userData.email }
        ]
      });

      if (existingUser) {
        console.log(`⚠️ Usuario ${userData.username} o email ${userData.email} ya existe, saltando...`);
        continue;
      }

      // Crear usuario con contraseña hasheada
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      // Insertar directamente sin crear instancia compleja
      await usersRepository.insert({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        role: userData.role
      });

      console.log(`✅ Usuario ${userData.username} (${userData.role}) creado`);
    }

    // Verificar usuarios creados
    const finalUsers = await usersRepository.find({
      select: ['id', 'username', 'email', 'role']
    });
    
    console.log(`\n📊 Total de usuarios en base de datos: ${finalUsers.length}`);
    console.log('\n👥 Usuarios creados:');
    finalUsers.forEach(user => {
      console.log(`   - ${user.username} (${user.role}) - ${user.email}`);
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

    console.log('\n🎯 Para probar 2FA:');
    console.log('   - Login con: prueba2fa / prueba123');
    console.log('   - El correo 2FA se enviará a: sistemas2@lamaria.gov.co');
    console.log('   - Mientras tanto, el código aparecerá en los logs del servidor');

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