import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RendicionCuentasController } from './rendicion-cuentas.controller';
import { RendicionCuentasService } from './rendicion-cuentas.service';
import { EstadisticasRendicionCuentasController } from './estadisticas/estadisticas-rendicion-cuentas.controller';
import { EstadisticasRendicionCuentasService } from './estadisticas/estadisticas-rendicion-cuentas.service';
import { RendicionCuentasDocumento } from './entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from './entities/rendicion-cuentas-historial.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AsesorGerenciaDocumento } from '../asesor-gerencia/entities/asesor-gerencia-documento.entity'; // ✅ AGREGAR
import { TesoreriaDocumento } from '../tesoreria/entities/tesoreria-documento.entity'; // ✅ AGREGAR
import { RadicacionModule } from '../radicacion/radicacion.module';
import { BitacoraSistemaModule } from '../bitacora-sistema/bitacora-sistema.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RendicionCuentasDocumento,
      RendicionCuentasHistorial,
      Documento,
      User,
      AsesorGerenciaDocumento, // ✅ AGREGAR
      TesoreriaDocumento,      // ✅ AGREGAR
      BitacoraSistemaModule,
    ]),
    RadicacionModule,
  ],
  controllers: [
    RendicionCuentasController,
    EstadisticasRendicionCuentasController,
  ],
  providers: [
    RendicionCuentasService,
    EstadisticasRendicionCuentasService,
  ],
  exports: [RendicionCuentasService, EstadisticasRendicionCuentasService],
})
export class RendicionCuentasModule {}