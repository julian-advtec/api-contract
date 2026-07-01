import { Module, forwardRef, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista } from './entities/documento-contratista.entity';
import { ContratistaService } from './services/contratista.service';
import { ContratistaDocumentoService } from './services/contratista-documento.service';
import { ContratistaTokenService } from './services/contratista-token.service';
import { ContratistasController } from './controllers/contratista.controller';
import { ContratistaPublicoController } from './controllers/contratista-publico.controller';
import { ContratistaDocumentoController } from './controllers/contratista-documento.controller';
import { StorageModule } from '../common/storage/storage.module';
import { BitacoraSistemaModule } from '../bitacora-sistema/bitacora-sistema.module';
import { EmailService } from '../email/email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contratista, DocumentoContratista]),
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
    ContratistaPublicoController,      // ✅ PRIMERO - RUTAS ESPECÍFICAS
    ContratistaDocumentoController,
    ContratistasController,            // ✅ ÚLTIMO - RUTAS GENÉRICAS
  ],
  providers: [
    ContratistaService,
    ContratistaDocumentoService,
    ContratistaTokenService,
    EmailService,
  ],
  exports: [ContratistaService]
})
export class ContratistasModule {
  private readonly logger = new Logger(ContratistasModule.name);
  
  constructor() {
    this.logger.log('✅✅✅ CONTRATISTAS MODULE INICIALIZADO');
    this.logger.log('📡 Controladores registrados:');
    this.logger.log('   - ContratistaPublicoController');
    this.logger.log('   - ContratistaDocumentoController');
    this.logger.log('   - ContratistasController');
  }
}