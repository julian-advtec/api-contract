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
    password: '',
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
  console.log('🚀 Iniciando seed de usuarios...');
  
  const dataSource = new DataSource(ormconfig);
  
  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    const usersRepository = dataSource.getRepository(User);
    
    // 0. PRIMERO: Verificar y corregir problemas de columnas NULL
    console.log('🔍 Verificando estructura de la tabla...');
    try {
      const queryRunner = dataSource.createQueryRunner();
      
      // Si la tabla no existe, salir (TypeORM la creará al iniciar)
      const tableExists = await queryRunner.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        );
      `);
      
      if (!tableExists[0].exists) {
        console.log('⚠️  La tabla users no existe. Ejecuta primero tu aplicación NestJS.');
        console.log('💡 Ejecuta: npm run start:dev');
        return;
      }
      
      // Verificar si hay problemas de NOT NULL
      const nullColumns = await queryRunner.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND is_nullable = 'NO'
        AND column_name IN ('username', 'email', 'full_name', 'role', 'password');
      `);
      
      console.log(`📊 Columnas NOT NULL encontradas: ${nullColumns.length}`);
      
    } catch (checkError) {
      console.log('⚠️  Error verificando tabla:', checkError.message);
    }

    // 1. LIMPIAR TABLA (si existe)
    console.log('🧹 Limpiando tabla users...');
    try {
      await dataSource.query('TRUNCATE TABLE users CASCADE');
      console.log('✅ Tabla limpiada con TRUNCATE');
    } catch (error) {
      console.log('⚠️  TRUNCATE falló, intentando DELETE...');
      try {
        await usersRepository.clear();
        console.log('✅ Tabla limpiada con DELETE');
      } catch (clearError) {
        console.log('⚠️  DELETE también falló. Puede que la tabla esté vacía o no exista.');
      }
    }

    // 2. CREAR USUARIOS
    console.log(`🌱 Creando ${usersToSeed.length} usuarios...`);
    
    const createdUsers = [];
    
    for (const userData of usersToSeed) {
      try {
        const hashedPassword = await bcrypt.hash(userData.password, 12);
        
        const user = usersRepository.create({
          username: userData.username,
          email: userData.email,
          password: hashedPassword,
          role: userData.role,
          fullName: userData.fullName,
          isActive: true,
          isEmailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'system_seed'
        });

        await usersRepository.save(user);
        createdUsers.push(user);
        console.log(`✅ ${userData.username} (${userData.role}) creado`);
        
      } catch (error) {
        console.error(`❌ Error creando ${userData.username}:`, error.message);
        
        // Si es error de NULL, intentar método alternativo
        if (error.message.includes('null value')) {
          console.log(`🔄 Intentando método alternativo para ${userData.username}...`);
          try {
            // Insert directo con SQL
            const hashedPassword = await bcrypt.hash(userData.password, 12);
            await dataSource.query(`
              INSERT INTO users (id, username, email, password, role, full_name, is_active, is_email_verified, created_at, updated_at, created_by)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, true, NOW(), NOW(), 'system_seed')
            `, [userData.username, userData.email, hashedPassword, userData.role, userData.fullName]);
            console.log(`✅ ${userData.username} creado con SQL directo`);
          } catch (sqlError) {
            console.error(`❌ Error SQL para ${userData.username}:`, sqlError.message);
          }
        }
      }
    }

    // 3. VERIFICAR RESULTADO
    const finalCount = await usersRepository.count();
    console.log(`\n📊 Total de usuarios creados: ${finalCount}/${usersToSeed.length}`);
    
    if (finalCount > 0) {
      const users = await usersRepository.find({
        select: ['username', 'email', 'role', 'fullName'],
        take: 5
      });
      
      console.log('\n👥 Primeros usuarios en la BD:');
      users.forEach(user => {
        console.log(`   - ${user.username} (${user.role})`);
      });
    }

    console.log('\n🎉 Seed completado!');
    console.log('\n🔑 Credenciales de prueba:');
    console.log('👑 Admin (NO 2FA): sistemas2 / sistemas123');
    console.log('🧪 Prueba 2FA: prueba2fa / prueba123');
    console.log('📝 Radicador: radicador1 / radicador123');
    console.log('👀 Supervisor: supervisor1 / supervisor123');

  } catch (error) {
    console.error('❌ Error fatal en seed:', error);
    console.error('Stack:', error.stack);
    
    // Si es el error de "column contains null values"
    if (error.message?.includes('contiene valores null')) {
      console.log('\n⚠️  ⚠️  ⚠️  PROBLEMA CRÍTICO');
      console.log('💡 EJECUTA ESTOS COMANDOS EN ORDEN:');
      console.log('1. psql -U postgres -d contract_db -c "DROP TABLE IF EXISTS users CASCADE;"');
      console.log('2. Reinicia tu aplicación NestJS (npm run start:dev)');
      console.log('3. Vuelve a ejecutar este script: npx ts-node scripts/seed-users.ts');
    }
    
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Conexión cerrada');
    }
  }
}

// Ejecutar el script
seedUsers().catch(error => {
  console.error('❌ Error no manejado:', error);
  process.exit(1);
});