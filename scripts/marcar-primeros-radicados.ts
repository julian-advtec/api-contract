// scripts/marcar-primeros-radicados.ts
import { DataSource } from 'typeorm';
import { Documento } from '../src/radicacion/entities/documento.entity';
import 'dotenv/config';
import { ormconfig } from '../src/config/ormconfig';

async function marcarPrimerosRadicados() {
    console.log('🚀 Iniciando proceso para marcar primeros radicados del año...');
    console.log('📝 Este script verifica y corrige los primeros radicados por año');
    
    const dataSource = new DataSource(ormconfig);
    
    try {
        await dataSource.initialize();
        console.log('✅ Conectado a la base de datos');
        
        const documentoRepository = dataSource.getRepository(Documento);
        
        // 1. Primero, desmarcar todos
        console.log('🔄 Desmarcando todos los documentos...');
        await documentoRepository
            .createQueryBuilder()
            .update(Documento)
            .set({ primerRadicadoDelAno: false })
            .execute();
        
        // 2. Obtener todos los documentos ordenados por fecha de radicación
        console.log('📋 Obteniendo documentos ordenados por fecha...');
        
        const documentos = await documentoRepository
            .createQueryBuilder('documento')
            .where("documento.numeroRadicado ~ '^R\\d{4}-\\d{3}$'")
            .orderBy('documento.fechaRadicacion', 'ASC')
            .getMany();
        
        console.log(`📊 Total de documentos válidos a procesar: ${documentos.length}`);
        
        const anosProcesados = new Set<string>();
        let marcados = 0;
        
        // 3. Marcar primeros de cada año
        console.log('🏷️ Marcando primeros documentos de cada año...');
        for (const documento of documentos) {
            const match = documento.numeroRadicado.match(/^R(\d{4})-\d{3}$/);
            if (!match) {
                console.log(`⚠️ Formato inválido ignorado: ${documento.numeroRadicado}`);
                continue;
            }
            
            const ano = match[1];
            
            if (!anosProcesados.has(ano)) {
                documento.primerRadicadoDelAno = true;
                await documentoRepository.save(documento);
                anosProcesados.add(ano);
                marcados++;
                console.log(`✅ Marcado: ${documento.numeroRadicado} como primer radicado de ${ano}`);
            }
        }
        
        console.log(`\n🎉 PROCESO COMPLETADO:`);
        console.log(`📊 Documentos procesados: ${documentos.length}`);
        console.log(`📅 Años encontrados: ${anosProcesados.size}`);
        console.log(`✅ Documentos marcados como primeros del año: ${marcados}`);
        
        // 4. Mostrar resumen por año
        console.log(`\n📋 RESUMEN POR AÑO:`);
        const anosArray = Array.from(anosProcesados).sort();
        for (const ano of anosArray) {
            const primerRadicado = documentos.find(d => 
                d.numeroRadicado.startsWith(`R${ano}-`) && 
                d.primerRadicadoDelAno === true
            );
            console.log(`  ${ano}: ${primerRadicado?.numeroRadicado || 'No encontrado'}`);
        }
        
        // 5. Verificar en base de datos
        const conteoFinal = await documentoRepository.count({
            where: { primerRadicadoDelAno: true }
        });
        console.log(`\n🔍 Verificación en BD: ${conteoFinal} documentos marcados`);
        
    } catch (error) {
        console.error(`❌ Error en el proceso:`, error);
    } finally {
        await dataSource.destroy();
        console.log('🔌 Conexión cerrada');
    }
}

// Exportar la función para uso en otros scripts
export { marcarPrimerosRadicados };

// Si se ejecuta directamente, ejecutar la función
if (require.main === module) {
    marcarPrimerosRadicados();
}