// scripts/seed-users.ts
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
  console.log('🚀 Iniciando seed de usuarios (todos en minúscula)...');
  
  const dataSource = new DataSource(ormconfig);
  
  try {
    await dataSource.initialize();
    console.log('✅ Conectado a la base de datos');

    const usersRepository = dataSource.getRepository(User);
    
    // 1. PRIMERO: VERIFICAR SI HAY REGISTROS EXISTENTES
    console.log('🔍 Verificando registros existentes...');
    const existingCount = await usersRepository.count();
    console.log(`📊 Usuarios existentes en la BD: ${existingCount}`);
    
    if (existingCount > 0) {
      console.log('🧹 Limpiando todos los usuarios existentes...');
      
      // Deshabilitar triggers temporalmente si existen
      try {
        await dataSource.query('ALTER TABLE users DISABLE TRIGGER ALL;');
        console.log('✅ Triggers deshabilitados');
      } catch (error) {
        console.log('ℹ️ No se pudieron deshabilitar triggers (puede ser normal)');
      }
      
      // Eliminar usando DELETE con cascade
      try {
        await dataSource.query('DELETE FROM users CASCADE;');
        console.log('✅ Todos los usuarios eliminados con DELETE CASCADE');
      } catch (error) {
        console.log('⚠️ DELETE CASCADE falló, intentando TRUNCATE...');
        try {
          await dataSource.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE;');
          console.log('✅ Tabla truncada con TRUNCATE');
        } catch (truncateError) {
          console.log('⚠️ TRUNCATE falló, intentando método manual...');
          try {
            await usersRepository.clear();
            console.log('✅ Tabla limpiada con clear()');
          } catch (clearError) {
            console.error('❌ Error limpiando tabla:', clearError.message);
            throw clearError;
          }
        }
      }
      
      // Rehabilitar triggers
      try {
        await dataSource.query('ALTER TABLE users ENABLE TRIGGER ALL;');
        console.log('✅ Triggers rehabilitados');
      } catch (error) {
        console.log('ℹ️ No se pudieron rehabilitar triggers');
      }
    } else {
      console.log('✅ La tabla está vacía, continuando...');
    }
    
    // 2. VERIFICAR QUE EL ENUM UserRole ESTÉ EN MINÚSCULA
    console.log('\n🔍 Verificando valores de UserRole enum:');
    console.log(`   UserRole.ADMIN: "${UserRole.ADMIN}"`);
    console.log(`   UserRole.RADICADOR: "${UserRole.RADICADOR}"`);
    console.log(`   UserRole.SUPERVISOR: "${UserRole.SUPERVISOR}"`);
    console.log(`   UserRole.AUDITOR_CUENTAS: "${UserRole.AUDITOR_CUENTAS}"`);
    
    // Asegurar que todos los roles del array estén en minúscula
    console.log('\n🔍 Verificando roles en el array de usuarios:');
    usersToSeed.forEach(user => {
      console.log(`   ${user.username}: role = "${user.role}" (tipo: ${typeof user.role})`);
    });

    // 3. CREAR USUARIOS NUEVOS
    console.log(`\n🌱 Creando ${usersToSeed.length} usuarios con roles en minúscula...`);
    
    const createdUsers = [];
    const errors = [];
    
    for (const userData of usersToSeed) {
      try {
        console.log(`\n📝 Creando usuario: ${userData.username}`);
        console.log(`   Email: ${userData.email}`);
        console.log(`   Rol: ${userData.role} (${typeof userData.role})`);
        
        // Asegurar que el rol esté en minúscula
        const normalizedRole = userData.role.toString().toLowerCase();
        console.log(`   Rol normalizado: ${normalizedRole}`);
        
        const hashedPassword = await bcrypt.hash(userData.password, 12);
        
        const user = usersRepository.create({
          username: userData.username,
          email: userData.email,
          password: hashedPassword,
          role: normalizedRole as UserRole,
          fullName: userData.fullName,
          isActive: true,
          isEmailVerified: true,
          createdBy: 'system_seed'
        });
        
        await usersRepository.save(user);
        
        console.log(`✅ ${userData.username} creado exitosamente`);
        createdUsers.push(userData.username);
        
      } catch (error) {
        console.error(`❌ Error creando ${userData.username}:`, error.message);
        if (error.detail) console.error(`   Detalle: ${error.detail}`);
        if (error.code) console.error(`   Código: ${error.code}`);
        errors.push({ user: userData.username, error: error.message });
      }
    }

    // 4. VERIFICAR RESULTADO
    console.log('\n📊 ====== RESUMEN DEL SEED ======');
    const finalCount = await usersRepository.count();
    console.log(`✅ Usuarios creados exitosamente: ${createdUsers.length}/${usersToSeed.length}`);
    console.log(`✅ Total de usuarios en la BD: ${finalCount}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errores encontrados:');
      errors.forEach(err => {
        console.log(`   - ${err.user}: ${err.error}`);
      });
    }
    
    if (finalCount > 0) {
      console.log('\n👥 Usuarios en la BD:');
      const users = await usersRepository.find({
        select: ['id', 'username', 'email', 'role', 'fullName'],
        order: { username: 'ASC' }
      });
      
      users.forEach(user => {
        console.log(`   - ${user.username}: email="${user.email}", role="${user.role}"`);
      });
      
      // Verificar específicamente el usuario sistemas2
      const sistemas2 = await usersRepository.findOne({
        where: { username: 'sistemas2' },
        select: ['username', 'role']
      });
      
      if (sistemas2) {
        console.log(`\n🔍 Usuario sistemas2 encontrado:`);
        console.log(`   Rol: "${sistemas2.role}"`);
        console.log(`   Tipo de dato: ${typeof sistemas2.role}`);
        console.log(`   ¿Es "admin"? ${sistemas2.role === 'admin'}`);
      }
    }

    console.log('\n🎉 Seed completado!');
    console.log('\n🔑 Credenciales de prueba:');
    console.log('👑 Admin (sistemas2): sistemas2 / sistemas123');
    console.log('📝 Radicador (prueba2fa): prueba2fa / prueba123');
    console.log('📝 Radicador (radicador1): radicador1 / radicador123');
    console.log('👀 Supervisor (supervisor1): supervisor1 / supervisor123');

  } catch (error) {
    console.error('\n❌ Error fatal en seed:', error);
    console.error('Stack:', error.stack);
    
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('\n🔌 Conexión a la base de datos cerrada');
    }
  }
}

// Ejecutar el script
seedUsers().catch(error => {
  console.error('❌ Error no manejado:', error);
  process.exit(1);
});