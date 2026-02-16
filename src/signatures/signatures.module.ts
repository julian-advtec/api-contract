// signatures/signatures.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt'; // 👈 IMPORTAR
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';
import { EncryptionService } from './encryption.service';
import { Signature } from './entities/signature.entity';
import { User } from '../users/entities/user.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signature, User]),
    JwtModule.registerAsync({ // 👈 REGISTRAR JwtModule
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SignaturesController],
  providers: [SignaturesService, EncryptionService],
  exports: [SignaturesService],
})
export class SignaturesModule {}