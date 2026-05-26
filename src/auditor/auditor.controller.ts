import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Body,
  ParseUUIDPipe,
  Res,
  Query,
  Delete,
  BadRequestException,
  Logger,
  Req,
  HttpStatus,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';

import * as os from 'os';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

import * as mime from 'mime-types';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Documento } from './../radicacion/entities/documento.entity';
import { JwtAuthGuard } from './../common/guards/jwt-auth.guard';
import { RolesGuard } from './../common/guards/roles.guard';
import { AuditorGuard } from './../common/guards/auditor.guard';
import { Roles } from './../auth/decorators/roles.decorator';
import { GetUser } from './../auth/decorators/get-user.decorator';
import { UserRole } from './../users/enums/user-role.enum';
import { AuditorService } from './auditor.service';
import { SubirDocumentosAuditorDto } from './dto/subir-documentos-auditor.dto';
import { RevisarAuditorDocumentoDto } from './dto/revisar-auditor-documento.dto';
import { AuditorValidationHelper } from './auditor-validation.helper';
import { multerAuditorConfig } from './../config/multer-auditor.config';
import { AuditorDocumento } from './entities/auditor-documento.entity';
import { LoadDocumentoInterceptor } from '../common/interceptors/load-documento.interceptor';
import { Public } from './../common/decorators/public.decorator';  // ← Asegúrate de importar esto

const execAsync = promisify(exec);

@Controller('auditor')
@UseGuards(JwtAuthGuard, RolesGuard, AuditorGuard)
@Roles(UserRole.AUDITOR_CUENTAS, UserRole.ADMIN, UserRole.SUPERVISOR)
export class AuditorController {
  private readonly logger = new Logger(AuditorController.name);

  constructor(private readonly auditorService: AuditorService) { }

  @Get('documentos/disponibles')
  async getDocumentosDisponibles(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosDisponibles(user.id);
  }

  @Post('documentos/:documentoId/subir-auditoria')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'rp', maxCount: 1 },
        { name: 'cdp', maxCount: 1 },
        { name: 'poliza', maxCount: 1 },
        { name: 'certificadoBancario', maxCount: 1 },
        { name: 'minuta', maxCount: 1 },
        { name: 'actaInicio', maxCount: 1 },
      ],
      multerAuditorConfig,
    ),
  )
  async subirArchivosAuditoria(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() body: any,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
  ) {
    console.log('[AUDITOR] ¡LLEGÓ AL CONTROLADOR!');
    console.log('Usuario:', user.id, user.username);
    console.log('Body recibido:', body);
    console.log('Archivos recibidos:', Object.keys(files || {}));

    return this.auditorService.subirDocumentosAuditor(
      documentoId,
      user.id,
      { observaciones: body.observaciones || '' },
      files,
    );
  }


  @Get('mis-documentos')
  async getMisDocumentos(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosEnRevision(user.id);
  }


  @Get('documentos/:documentoId')
  async getDetalleDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerDetalleDocumento(documentoId, user.id);
  }

  @Post('documentos/:documentoId/subir-documentos')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'rp', maxCount: 1 },
        { name: 'cdp', maxCount: 1 },
        { name: 'poliza', maxCount: 1 },
        { name: 'certificadoBancario', maxCount: 1 },
        { name: 'minuta', maxCount: 1 },
        { name: 'actaInicio', maxCount: 1 },
      ],
      multerAuditorConfig,
    ),
  )
  async subirDocumentosAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() subirDto: SubirDocumentosAuditorDto,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
  ) {
    this.logger.log(`[SUBIR DOCUMENTOS] Archivos: ${Object.keys(files)}`);
    return this.auditorService.subirDocumentosAuditor(
      documentoId,
      user.id,
      subirDto,
      files,
    );
  }

  @Put('documentos/:documentoId/revisar')
  async revisarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() body: any,
  ) {
    this.logger.log(`[REVISAR] Usuario ${user.id} revisando documento ${documentoId}`);

    try {
      const revisarDto = AuditorValidationHelper.crearDto(body);
      const validationErrors = AuditorValidationHelper.validateRevisarDto(revisarDto);
      if (validationErrors.length > 0) {
        throw new BadRequestException(validationErrors.join('; '));
      }

      this.logger.log(`[REVISAR] Estado: ${revisarDto.estado}, Observaciones: ${revisarDto.observaciones?.substring(0, 50)}...`);

      return await this.auditorService.revisarDocumento(
        documentoId,
        user.id,
        revisarDto,
      );
    } catch (error) {
      this.logger.error(`[REVISAR ERROR] ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('documentos/:documentoId/descargar-radicado/:numeroArchivo')
  async descargarArchivoRadicado(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    const { ruta, nombre } = await this.auditorService.descargarArchivoRadicado(
      documentoId,
      numeroArchivo,
      user.id,
    );
    res.download(ruta, nombre);
  }

  // RUTA PÚBLICA - SIN AUTENTICACIÓN
  @Get('documentos/:documentoId/archivo-auditor/:tipo')
  @Public() // ← Ya es pública, mantener
  async previsualizarArchivoAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipo') tipo: string,
    @Query('download') download: string = 'false',
    @Res() res: Response,
  ) {
    this.logger.log(`[PUBLIC-PREVIEW] Acceso público → ${documentoId}/${tipo}`);

    try {
      const { rutaAbsoluta, nombreArchivo } = await this.auditorService.obtenerRutaArchivoAuditorFull(
        documentoId,
        tipo,
        undefined
      );

      if (!fs.existsSync(rutaAbsoluta)) {
        this.logger.error(`[PUBLIC-PREVIEW 404] No existe: ${rutaAbsoluta}`);
        return res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado' });
      }

      const ext = path.extname(nombreArchivo).toLowerCase();

      if (['.doc', '.docx'].includes(ext) && download !== 'true') {
        const tmpPdf = path.join(os.tmpdir(), `preview-${crypto.randomUUID()}.pdf`);
        try {
          await this.auditorService.convertirWordAPdf(rutaAbsoluta, tmpPdf);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline; filename="vista.pdf"');
          const stream = fs.createReadStream(tmpPdf);
          stream.on('end', () => fs.unlink(tmpPdf, () => { }));
          return stream.pipe(res);
        } catch (e) {
          this.logger.error(`[CONVERSIÓN ERROR] ${e.message}`);
        }
      }

      const mimeType = mime.lookup(ext) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', download === 'true' ? `attachment; filename="${nombreArchivo}"` : 'inline');
      return fs.createReadStream(rutaAbsoluta).pipe(res);
    } catch (error: any) {
      this.logger.error(`[PUBLIC-PREVIEW ERROR] ${error.message}`);
      res.status(500).json({ message: error.message || 'Error al procesar archivo' });
    }
  }

  // RUTA PÚBLICA - SIN AUTENTICACIÓN
  @Get('documentos/:documentoId/descargar-auditor/:tipo')
  @Public()
  async descargarForzadoAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipo') tipo: string,
    @Res() res: Response,
  ) {
    this.logger.log(`[PUBLIC-DOWNLOAD] Descarga pública → ${documentoId}/${tipo}`);

    try {
      const { rutaAbsoluta, nombreArchivo } = await this.auditorService.obtenerRutaArchivoAuditorFull(
        documentoId,
        tipo,
        undefined
      );

      if (!fs.existsSync(rutaAbsoluta)) {
        this.logger.error(`[PUBLIC-DOWNLOAD 404] No existe: ${rutaAbsoluta}`);
        return res.status(404).json({ message: 'Archivo no encontrado' });
      }

      res.download(rutaAbsoluta, nombreArchivo, (err) => {
        if (err) this.logger.error(`[PUBLIC-DOWNLOAD ERROR] ${err.message}`);
      });
    } catch (error: any) {
      this.logger.error(`[PUBLIC-DOWNLOAD ERROR] ${error.message}`);
      res.status(500).json({ message: error.message || 'Error al descargar archivo' });
    }
  }

  @Delete('documentos/:documentoId/liberar')
  async liberarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
  ) {
    return this.auditorService.liberarDocumento(documentoId, user.id);
  }

  @Get('estadisticas')
  async getEstadisticas(@GetUser() user: any) {
    return this.auditorService.obtenerEstadisticasAuditor(user.id);
  }

  @Get('buscar')
  async buscarDocumentos(
    @GetUser() user: any,
    @Query('numeroRadicado') numeroRadicado?: string,
    @Query('numeroContrato') numeroContrato?: string,
    @Query('documentoContratista') documentoContratista?: string,
    @Query('estado') estado?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.auditorService.obtenerDocumentosDisponibles(user.id);
  }

  @Get('historial')
  async getHistorial(@GetUser() user: any) {
    return this.auditorService.obtenerHistorialAuditor(user.id);
  }

  @Get('documentos/:documentoId/vista')
  async getDocumentoParaVista(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() userFromDecorator: any,
    @Req() req: Request
  ) {
    console.log('[AUDITOR-CONTROLLER] ===== VISTA DOCUMENTO =====');
    console.log('[AUDITOR-CONTROLLER] Documento ID:', documentoId);
    console.log('[AUDITOR-CONTROLLER] Usuario rol:', userFromDecorator?.role);

    let auditorId = userFromDecorator?.id;

    if (!auditorId && userFromDecorator) {
      auditorId = userFromDecorator.id || userFromDecorator.userId || userFromDecorator.sub;
    }

    if (!auditorId && (req as any).user) {
      auditorId = (req as any).user.id || (req as any).user.userId || (req as any).user.sub;
    }

    console.log('[AUDITOR-CONTROLLER] AuditorId final:', auditorId || 'NO ENCONTRADO');

    const resultado = await this.auditorService.obtenerDocumentoParaVista(documentoId, auditorId);
    
    console.log('[AUDITOR-CONTROLLER] Acta en respuesta:', {
      tieneActa: !!resultado.documento?.actaSupervisionPath,
      path: resultado.documento?.actaSupervisionPath,
      nombre: resultado.documento?.actaSupervisionNombre
    });
    
    console.log('[AUDITOR-CONTROLLER] ===========================');
    
    return resultado;
  }

  // Endpoint para archivos de auditoría (permitir acceso GET)
  

  @Get('mis-auditorias')
  async getMisAuditorias(@GetUser() user: any) {
    this.logger.log(`[MIS-AUDITORIAS] Usuario: ${user.id} ${user.username}`);
    return this.auditorService.obtenerMisAuditorias(user.id);
  }

  @Get('documentos/:documentoId/estado-archivos')
  async getEstadoArchivos(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerEstadoArchivos(documentoId, user.id);
  }

  @Get('documentos/:documentoId/debug')
  async getDocumentoDebug(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerDocumentoDebug(documentoId, user.id);
  }

  @Post('documentos/:documentoId/revision-completa')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'rp', maxCount: 1 },
        { name: 'cdp', maxCount: 1 },
        { name: 'poliza', maxCount: 1 },
        { name: 'certificadoBancario', maxCount: 1 },
        { name: 'minuta', maxCount: 1 },
        { name: 'actaInicio', maxCount: 1 },
        { name: 'estado', maxCount: 1 },
        { name: 'observaciones', maxCount: 1 },
        { name: 'data', maxCount: 1 },
      ],
      multerAuditorConfig,
    ),
  )
  async revisionCompleta(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() userFromDecorator: any,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] } | undefined,
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           [REVISION-COMPLETA] PETICIÓN RECIBIDA            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log('Documento ID:', documentoId);

    let user = userFromDecorator;

    if (!user?.id && userFromDecorator) {
      user = {
        id: userFromDecorator.id || userFromDecorator.userId || userFromDecorator.sub,
        username: userFromDecorator.username,
        role: userFromDecorator.role,
      };
    }

    if (!user?.id && (req as any).user) {
      user = (req as any).user;
      console.log('[FALLBACK] Usuario encontrado en req.user');
    }

    console.log('Usuario final:', user ? user.id : 'NO USER');
    console.log('Rol detectado:', user?.role || 'desconocido');

    if (!user?.id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Usuario no autenticado',
        debug: { authHeader: !!req.headers.authorization }
      });
    }

    if (![UserRole.ADMIN, UserRole.AUDITOR_CUENTAS].includes(user.role)) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'No tienes permisos para registrar revisiones completas'
      });
    }

    try {
      let estado = '';
      let observaciones = '';

      if (body.estado) {
        estado = (body.estado || '').trim().toUpperCase();
        observaciones = (body.observaciones || '').trim();
      } else if (body.data) {
        try {
          const parsed = JSON.parse(body.data);
          estado = (parsed.estado || '').trim().toUpperCase();
          observaciones = (parsed.observaciones || '').trim();
        } catch (e) {
          return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Formato inválido en "data"' });
        }
      }

      if (!estado) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Falta el campo "estado"' });
      }

      const estadosValidos = ['APROBADO', 'OBSERVADO', 'RECHAZADO', 'COMPLETADO'];
      if (!estadosValidos.includes(estado)) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: `Estado inválido: ${estado}` });
      }

      console.log(`[OK] Decisión procesada: ${estado}`);

      let archivosGuardados: Record<string, string> = {};

      if (files && Object.keys(files).length > 0) {
        console.log(`[SUBIENDO] ${Object.keys(files).length} archivos...`);

        const subirResultado = await this.auditorService.subirDocumentosAuditor(
          documentoId,
          user.id,
          { observaciones },
          files
        );

        archivosGuardados = subirResultado.archivosGuardados || {};
        console.log('[OK] Archivos procesados y guardados:', archivosGuardados);
      } else {
        console.log('[INFO] No se recibieron archivos nuevos');
      }

      const revisarDto = AuditorValidationHelper.crearDto({ estado, observaciones });
      const resultado = await this.auditorService.revisarDocumento(documentoId, user.id, revisarDto);

      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'Decisión registrada correctamente',
        estadoFinal: resultado.documento.estado,
        archivosGuardados,
        auditor: resultado.auditor,
        documento: resultado.documento,
      });
    } catch (error: any) {
      console.error('╔════════════════════════════════════════════════════════════╗');
      console.error('║ ERROR CRÍTICO EN REVISION-COMPLETA                         ║');
      console.error('╚════════════════════════════════════════════════════════════╝');
      console.error('Mensaje:', error.message);
      console.error('Stack (primeras líneas):', error.stack?.split('\n').slice(0, 6).join('\n') || 'sin stack');

      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Error interno al procesar revisión completa',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }

  @Get('documentos/:documentoId/diagnostico')
  async getDiagnostico(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.diagnosticoDocumentos(documentoId, user.id);
  }

  @Post('documentos/:documentoId/tomar')
  async tomarDocumentoParaRevision(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
  ) {
    this.logger.log(`[TOMAR] Usuario ${user.id} (${user.username}) intentando tomar documento ${documentoId}`);

    try {
      const resultado = await this.auditorService.tomarDocumentoParaRevision(
        documentoId,
        user.id,
      );

      this.logger.log(`[TOMAR] Éxito: ${resultado.message}`);
      return resultado;
    } catch (error) {
      this.logger.error(`[TOMAR ERROR] ${error.message}`, error.stack);
      throw error;
    }
  }

@Get('documentos/:documentoId/acta')
@Public() // ← Permite acceso sin autenticación
async verActaSupervision(
  @Param('documentoId', ParseUUIDPipe) documentoId: string,
  @Query('download') download: string = 'false',
  @Res() res: Response,
) {
  this.logger.log(`[ACTA] Solicitando acta para documento: ${documentoId}, download: ${download}`);

  try {
    // 1. Buscar el documento
    const documento = await this.auditorService.obtenerDocumentoConActa(documentoId);

    if (!documento) {
      this.logger.warn(`[ACTA] Documento no encontrado: ${documentoId}`);
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    // 2. Verificar que tenga acta de supervisión
    if (!documento.actaSupervisionPath || documento.actaSupervisionPath.trim() === '') {
      this.logger.warn(`[ACTA] Documento ${documentoId} no tiene acta de supervisión`);
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'El documento no tiene acta de supervisión asociada'
      });
    }

    // ✅ CORRECCIÓN: Usar la ruta base del servidor de red
    const basePath = process.env.STORAGE_LOCAL_PATH || '\\\\R2-D2\\api-contract';
    
    // Limpiar la ruta original (reemplazar \ por / si es necesario)
    let rutaRelativa = documento.actaSupervisionPath.replace(/\\/g, '/');
    
    // Construir ruta absoluta correcta
    let rutaAbsoluta = path.join(basePath, rutaRelativa);
    
    this.logger.log(`[ACTA] Ruta original en BD: ${documento.actaSupervisionPath}`);
    this.logger.log(`[ACTA] Base path: ${basePath}`);
    this.logger.log(`[ACTA] Ruta absoluta construida: ${rutaAbsoluta}`);

    // 4. Verificar que el archivo exista físicamente
    if (!fs.existsSync(rutaAbsoluta)) {
      this.logger.error(`[ACTA] Archivo NO encontrado en: ${rutaAbsoluta}`);

      // Buscar en ubicaciones alternativas dentro del servidor de red
      const posiblesRutas = [
        rutaAbsoluta,
        path.join(basePath, 'uploads', path.basename(rutaRelativa)),
        path.join(basePath, 'uploads', 'actas', path.basename(rutaRelativa)),
        path.join(basePath, 'uploads', 'auxiliar-auditor', path.basename(rutaRelativa)),
        path.join(basePath, 'uploads', 'documentos', 'actas', path.basename(rutaRelativa)),
        // Buscar en la estructura de carpetas del número de documento
        path.join(basePath, rutaRelativa.replace(/\//g, path.sep)),
        // Buscar directamente en la ruta completa sin modificar
        path.join(basePath, documento.actaSupervisionPath),
      ];

      let archivoEncontrado = false;
      for (const ruta of posiblesRutas) {
        if (fs.existsSync(ruta)) {
          rutaAbsoluta = ruta;
          archivoEncontrado = true;
          this.logger.log(`[ACTA] ✅ Archivo encontrado en ruta alternativa: ${ruta}`);
          break;
        }
      }

      if (!archivoEncontrado) {
        this.logger.error(`[ACTA] ❌ Archivo no encontrado en ninguna ubicación`);
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Archivo de acta no encontrado en el servidor',
          debug: {
            pathOriginal: documento.actaSupervisionPath,
            basePath: basePath,
            rutasBuscadas: posiblesRutas
          }
        });
      }
    }

    // 5. Obtener nombre del archivo
    const nombreArchivo = documento.actaSupervisionNombre ||
      `acta_supervision_${documento.numeroRadicado || documentoId}.pdf`;

    // 6. Configurar headers
    const mimeType = 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreArchivo)}"`);
      this.logger.log(`[ACTA] Descargando archivo: ${nombreArchivo}`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nombreArchivo)}"`);
      this.logger.log(`[ACTA] Visualizando archivo: ${nombreArchivo}`);
    }

    // 7. Enviar el archivo
    const stat = fs.statSync(rutaAbsoluta);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(rutaAbsoluta);

    stream.on('error', (error) => {
      this.logger.error(`[ACTA] Error al leer archivo: ${error.message}`);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Error al leer el archivo'
        });
      }
    });

    stream.on('end', () => {
      this.logger.log(`[ACTA] Archivo enviado correctamente: ${stat.size} bytes`);
    });

    return stream.pipe(res);

  } catch (error: any) {
    this.logger.error(`[ACTA ERROR] ${error.message}`, error.stack);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || 'Error al obtener el acta de supervisión'
    });
  }
}

  /**
   * Descargar acta de supervisión (método específico)
   */
@Get('documentos/:documentoId/acta/descargar')
@Public()
async descargarActaSupervision(
  @Param('documentoId', ParseUUIDPipe) documentoId: string,
  @Res() res: Response,
) {
  this.logger.log(`[ACTA-DOWNLOAD] Descargando acta para documento: ${documentoId}`);
  
  // Reutilizar el método ver con download=true
  return this.verActaSupervision(documentoId, 'true', res);
}
}