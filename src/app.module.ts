// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RadicacionModule } from './radicacion/radicacion.module';
import { SupervisionModule } from './supervision/supervisor.module';
import { EstadosModule } from './estados/estados.module';
import { AppDataSource } from './config/ormconfig';
import { ContratistasModule } from './contratista/contratista.module';
import { AuditorModule } from './auditor/auditor.module';
import { AuxiliarAuditorModule } from './auxiliar-auditor/auxiliar-auditor.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { TesoreriaModule } from './tesoreria/tesoreria.module';
import { SignaturesModule } from './signatures/signatures.module';
import { AsesorGerenciaModule } from './asesor-gerencia/asesor-gerencia.module';
import { RendicionCuentasModule } from './rendicion-cuentas/rendicion-cuentas.module';
import { StorageModule } from './common/storage/storage.module';
import { JuridicaModule } from './juridica/juridica.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.development', '.env.production'],
    }),
    TypeOrmModule.forRoot(AppDataSource.options),
    
    // ✅ CRÍTICO: Configurar MulterModule con límites ALTOS
    //    Sin esto, Multer rechaza archivos >1MB con error 400
    MulterModule.register({
      limits: {
        fileSize: 50 * 1024 * 1024,  // ✅ 50MB por archivo (default es 1MB)
        files: 50,                    // ✅ Máximo 30 archivos
        fieldSize: 50 * 1024 * 1024,  // ✅ 50MB por campo de texto
        fieldNameSize: 500,           // ✅ 500 caracteres por nombre de campo
      },
    }),
    
    StorageModule,
    UsersModule,
    AuthModule,
    RadicacionModule,
    SupervisionModule,
    EstadosModule,
    ContratistasModule,
    AuditorModule,
    AuxiliarAuditorModule,
    ContabilidadModule,
    TesoreriaModule,
    SignaturesModule,
    AsesorGerenciaModule,
    RendicionCuentasModule,
    JuridicaModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}