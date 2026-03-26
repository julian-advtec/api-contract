import { AppDataSource } from './ormconfig';

async function syncDatabase() {
  console.log('🔄 Sincronizando esquema de base de datos...');
  
  try {
    await AppDataSource.initialize();
    await AppDataSource.synchronize(false);  // false = no drop tables
    console.log('✅ Esquema sincronizado correctamente');
    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Error sincronizando DB:', error);
    process.exit(1);
  }
}

syncDatabase();