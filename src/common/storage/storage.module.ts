// src/common/storage/storage.module.ts
import { Module, Global, DynamicModule, Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageService } from './storage.interface';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';

@Global()
@Module({})
export class StorageModule {
  private static readonly logger = new Logger(StorageModule.name);

  static forRoot(): DynamicModule {
    const storageProvider: Provider = {
      provide: 'IStorageService',
      useFactory: (configService: ConfigService): IStorageService => {
        const storageType = configService.get<string>('storage.type', 'local');
        
        this.logger.log(`📦 Inicializando Storage Service: ${storageType.toUpperCase()}`);
        
        if (storageType === 's3') {
          return new S3StorageService(configService);
        }
        
        return new LocalStorageService(configService);
      },
      inject: [ConfigService],
    };

    return {
      module: StorageModule,
      providers: [storageProvider],
      exports: [storageProvider],
    };
  }
}