// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RadicacionModule } from './radicacion/radicacion.module';
import { SupervisionModule } from './supervision/supervisor.module';
import { EstadosModule } from './estados/estados.module';
import { AppDataSource } from './config/ormconfig'; // ✅ Cambiado a AppDataSource
import { ContratistaModule } from './contratista/contratista.module';
import { AuditorModule } from './auditor/auditor.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { TesoreriaModule } from './tesoreria/tesoreria.module';
import { SignaturesModule } from './signatures/signatures.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(AppDataSource.options), // ✅ Usar .options
    UsersModule,
    AuthModule,
    RadicacionModule,
    SupervisionModule,
    EstadosModule,
    ContratistaModule,
    AuditorModule,
    ContabilidadModule,
    TesoreriaModule,
    SignaturesModule
    
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }