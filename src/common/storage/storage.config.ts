// src/common/storage/storage.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  type: process.env.STORAGE_TYPE || 'local',
  local: {
    basePath: process.env.LOCAL_STORAGE_PATH || 'uploads',
    fallbackToLocal: process.env.FALLBACK_TO_LOCAL === 'true' || true,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
    bucket: process.env.SUPABASE_BUCKET || 'documentos',
  },
}));