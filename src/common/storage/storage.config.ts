// src/common/storage/storage.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  type: process.env.STORAGE_TYPE || 'local', // 'local' o 's3'
  
  // Configuración Local
  local: {
    basePath: process.env.LOCAL_STORAGE_PATH || '\\\\R2-D2\\api-contract',
    fallbackToLocal: process.env.FALLBACK_TO_LOCAL === 'true',
  },
  
  // Configuración S3
  s3: {
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.AWS_S3_ENDPOINT,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  },
}));