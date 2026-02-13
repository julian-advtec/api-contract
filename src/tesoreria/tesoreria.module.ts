import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaService } from './tesoreria.service';
import { TesoreriaDocumento } from './entities/tesoreria-documento.entity';   // ← debe estar aquí
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { ContabilidadDocumento } from '../contabilidad/entities/contabilidad-documento.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TesoreriaDocumento,           // ← muy importante que esté aquí
      Documento,
      User,
      ContabilidadDocumento
    ])
  ],
  controllers: [TesoreriaController],
  providers: [TesoreriaService],
  exports: [TesoreriaService]     // opcional, si lo usas en otros módulos
})
export class TesoreriaModule {}