import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { RadicacionController } from './radicacion.controller';
import { RadicacionService } from './radicacion.service';
import { Documento } from './entities/documento.entity';
import { multerConfig } from '../config/multer.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento]),
    MulterModule.register(multerConfig),
  ],
  controllers: [RadicacionController],
  providers: [RadicacionService],
})
export class RadicacionModule {}