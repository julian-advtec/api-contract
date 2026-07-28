// src/contratista/contratistas.module.ts
import { Module, forwardRef, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista } from './entities/documento-contratista.entity';
import { FormularioPublico } from './entities/formulario-publico.entity';
import { DocumentoFormularioPublico } from './entities/documento-formulario-publico.entity';
import { ContratistaService } from './services/contratista.service';
import { ContratistaDocumentoService } from './services/contratista-documento.service';
import { ContratistaTokenService } from './services/contratista-token.service';
import { FormularioPublicoService } from './services/formulario-publico.service';
import { ContratistasController } from './controllers/contratista.controller';
import { ContratistaPublicoController } from './controllers/contratista-publico.controller';
import { ContratistaDocumentoController } from './controllers/contratista-documento.controller';
import { StorageModule } from '../common/storage/storage.module';
import { BitacoraSistemaModule } from '../bitacora-sistema/bitacora-sistema.module';
import { EmailService } from '../email/email.service';
import { TokenUsado } from './entities/token-usado.entity'

@Module({
  imports: [
    // ✅ Configuración de Multer
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 25,
      },
    }),
    // ✅ REGISTRAR TODAS LAS ENTIDADES EN TypeORM
    TypeOrmModule.forFeature([
      Contratista,
      DocumentoContratista,
      FormularioPublico,              // ✅ REQUERIDO
      DocumentoFormularioPublico,      // ✅ REQUERIDO
      TokenUsado,
    ]),
    StorageModule,
    forwardRef(() => BitacoraSistemaModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
    ConfigModule,
  ],
  controllers: [
    ContratistaPublicoController,
    ContratistaDocumentoController,
    ContratistasController,
  ],
  providers: [
    ContratistaService,
    ContratistaDocumentoService,
    ContratistaTokenService,
    FormularioPublicoService,
    EmailService,
  ],
  exports: [
    ContratistaService,
    FormularioPublicoService,
  ]
})
export class ContratistasModule {
  private readonly logger = new Logger(ContratistasModule.name);
  
  constructor() {
    this.logger.log('✅✅✅ CONTRATISTAS MODULE INICIALIZADO');
    this.logger.log('📡 Controladores registrados:');
    this.logger.log('   - ContratistaPublicoController');
    this.logger.log('   - ContratistaDocumentoController');
    this.logger.log('   - ContratistasController');
    this.logger.log('📊 Entidades registradas en TypeORM:');
    this.logger.log('   - Contratista');
    this.logger.log('   - DocumentoContratista');
    this.logger.log('   - FormularioPublico (NUEVA)');
    this.logger.log('   - DocumentoFormularioPublico (NUEVA)');
  }
}