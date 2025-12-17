// scripts/test-libreoffice.ts
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const logger = new Logger('LibreOfficeTest');

export function testLibreOfficeInstallation() {
  logger.log('🔍 Probando instalación de LibreOffice...');
  
  const pathsToTest = [
    'soffice',
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 25\\program\\soffice.exe',
  ];
  
  for (const testPath of pathsToTest) {
    try {
      logger.log(`  Probando: ${testPath}`);
      
      if (testPath.includes('\\') || testPath.includes('/')) {
        if (fs.existsSync(testPath)) {
          const version = execSync(`"${testPath}" --version`, { encoding: 'utf8' });
          logger.log(`✅ Encontrado: ${testPath}`);
          logger.log(`  Versión: ${version.trim()}`);
          return testPath;
        }
      } else {
        try {
          const version = execSync(`${testPath} --version`, { encoding: 'utf8' });
          logger.log(`✅ Encontrado en PATH: ${testPath}`);
          logger.log(`  Versión: ${version.trim()}`);
          return testPath;
        } catch {
          continue;
        }
      }
    } catch (error) {
      // Continuar
    }
  }
  
  logger.error('❌ LibreOffice no encontrado');
  return null;
}

// Si se ejecuta directamente
if (require.main === module) {
  const result = testLibreOfficeInstallation();
  
  if (result) {
    console.log('\n✅ LibreOffice está disponible en:', result);
    
    // Probar conversión simple
    console.log('\n🔧 Probando conversión...');
    try {
      const tempDir = os.tmpdir();
      const testFile = path.join(tempDir, 'test.html');
      const outputDir = path.join(tempDir, 'test-output');
      
      fs.writeFileSync(testFile, '<html><body><h1>Test</h1></body></html>');
      fs.mkdirSync(outputDir, { recursive: true });
      
      const command = result === 'soffice' || result === 'soffice.exe'
        ? `soffice --headless --convert-to pdf --outdir "${outputDir}" "${testFile}"`
        : `"${result}" --headless --convert-to pdf --outdir "${outputDir}" "${testFile}"`;
      
      execSync(command, { stdio: 'pipe' });
      
      const files = fs.readdirSync(outputDir);
      const pdfFiles = files.filter(f => f.endsWith('.pdf'));
      
      if (pdfFiles.length > 0) {
        console.log('✅ Conversión exitosa');
        
        // Limpiar
        fs.unlinkSync(testFile);
        fs.rmSync(outputDir, { recursive: true });
      } else {
        console.log('⚠️ Conversión completada pero no se encontraron PDFs');
      }
    } catch (error: any) {
      console.log('❌ Error en prueba de conversión:', error.message);
    }
  } else {
    console.log('\n❌ LIBREOFFICE NO ENCONTRADO');
    console.log('\n📋 Instrucciones de instalación:');
    console.log('1. Descargar desde: https://www.libreoffice.org/download');
    console.log('2. Instalar normalmente');
    console.log('3. Añadir al PATH: C:\\Program Files\\LibreOffice\\program');
    console.log('4. Reiniciar terminal/IDE');
  }
}