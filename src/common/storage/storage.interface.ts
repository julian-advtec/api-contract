// src/common/storage/storage.interface.ts
export interface IStorageService {
  uploadFile(params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    path: string;
    metadata?: Record<string, any>;
  }): Promise<{ url: string; path: string; key: string }>;

  downloadFile(params: { path: string }): Promise<Buffer>;

  deleteFile(params: { path: string }): Promise<void>;

  getFileStream(params: { path: string }): Promise<NodeJS.ReadableStream>;

  fileExists(params: { path: string }): Promise<boolean>;
}