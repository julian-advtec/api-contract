// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { BitacoraSistemaModule } from '../bitacora-sistema/bitacora-sistema.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    BitacoraSistemaModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}