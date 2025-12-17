// src/common/converter/config/libreoffice.config.ts
export const LibreOfficeConfig = {
  // Rutas de búsqueda en Windows
  searchPaths: [
    'soffice',
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 7\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice 24\\program\\soffice.exe',
    process.env.PROGRAMFILES + '\\LibreOffice\\program\\soffice.exe',
    process.env['PROGRAMFILES(X86)'] + '\\LibreOffice\\program\\soffice.exe',
  ],

  // Configuración de conversión
  conversion: {
    timeout: 60000, // 60 segundos
    maxBuffer: 10 * 1024 * 1024, // 10MB
    headless: true,
    outputFormat: 'pdf',
    filter: 'writer_pdf_Export',
  },

  // Opciones de PDF
  pdfOptions: {
    version: '1.4',
    reduceImageResolution: true,
    maxImageResolution: 300,
    useTaggedPDF: true,
    exportBookmarks: true,
  },

  // Configuración de red
  network: {
    copyToLocal: true,
    tempPrefix: 'network-copy-',
    cleanupAfterConversion: true,
  },
};