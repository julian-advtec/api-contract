// src/common/converter/types/diagnosis.types.ts
import { Stats } from 'fs';

export interface DiagnosisResult {
  filePath: string;
  fileExists: boolean;
  fileSize: number;
  fileStats: Stats | null;
  libreOfficeAvailable: boolean;
  libreOfficeVersion: string | null;
  canReadFile: boolean;
  fileContentHex: string | null;
  networkAccess: boolean;
  tempCopySuccess: boolean;
  manualConversionTest: boolean;
  issues: string[];
  recommendations: string[];
}

export interface LibreOfficeCheckResult {
  available: boolean;
  version?: string;
}

export interface ManualTestResult {
  success: boolean;
  error?: string;
}