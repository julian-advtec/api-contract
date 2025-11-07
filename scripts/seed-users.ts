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
    username: 'admin',
    email: 'admin@contratos.com',
    password: 'admin123',
    role: UserRole.ADMIN
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

    for (const userData of usersToSeed) {
      // Verificar si el usuario ya existe
      const existingUser = await usersRepository.findOne({
        where: { username: userData.username }
      });

      if (existingUser) {
        console.log(`⚠️ Usuario ${userData.username} ya existe`);
        continue;
      }

      // Crear usuario
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      
      const user = usersRepository.create({
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        role: userData.role,
        isEmailVerified: true,
      });

      await usersRepository.save(user);
      console.log(`✅ Usuario ${userData.username} (${userData.role}) creado`);
    }

    console.log('\n🎉 Todos los usuarios han sido creados exitosamente!');
    console.log('\n📋 Credenciales de prueba:');
    console.log('👑 Admin: admin / admin123');
    console.log('📝 Radicador: radicador1 / radicador123');
    console.log('👀 Supervisor: supervisor1 / supervisor123');
    console.log('🔍 Auditor: auditor1 / auditor123');
    console.log('💰 Contabilidad: contabilidad1 / contabilidad123');
    console.log('🏦 Tesorería: tesoreria1 / tesoreria123');
    console.log('💼 Asesor: asesor1 / asesor123');
    console.log('📊 Rendición: rendicion1 / rendicion123');

  } catch (error) {
    console.error('❌ Error creando usuarios:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('✅ Conexión cerrada');
    }
  }
}

// Ejecutar el script
seedUsers();