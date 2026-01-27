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
  Req
} from '@nestjs/common';
import type { Request } from 'express'; // Importa type de express
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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

@Controller('auditor')
@UseGuards(JwtAuthGuard, RolesGuard, AuditorGuard)
@Roles(UserRole.AUDITOR_CUENTAS, UserRole.ADMIN)
export class AuditorController {
  private readonly logger = new Logger(AuditorController.name); // Añadir logger

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
      multerAuditorConfig,   // ← usa la config que acabamos de crear
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

    // Aquí llamas al servicio
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
      // Crear DTO usando el helper
      const revisarDto = AuditorValidationHelper.crearDto(body);

      // Validar usando el helper
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

  @Get('documentos/:documentoId/descargar-auditor/:tipoArchivo')
  async descargarArchivoAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipoArchivo') tipoArchivo: string,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    const { ruta, nombre } = await this.auditorService.descargarArchivoAuditor(
      documentoId,
      tipoArchivo,
      user.id,
    );
    res.download(ruta, nombre);
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
    @GetUser() user: any,
    @Req() req: Request // Ahora Request viene de 'express'
  ) {
    console.log('[AUDITOR-CONTROLLER] ===== VISTA DOCUMENTO =====');
    console.log('[AUDITOR-CONTROLLER] Documento ID:', documentoId);
    console.log('[AUDITOR-CONTROLLER] User del decorador:', user ? user.id : 'undefined');
    console.log('[AUDITOR-CONTROLLER] User completo:', user);

    // 🔴 EXTRAER AUDITOR ID DE MÚLTIPLES FUENTES
    let auditorId = user?.id;

    // 1. Primero del decorador @GetUser()
    if (!auditorId && user) {
      console.log('[AUDITOR-CONTROLLER] Intentando extraer id de user object...');
      auditorId = user.id || user._id || user.userId;
    }

    // 2. Si no, del header X-Auditor-Id
    if (!auditorId) {
      // Acceso por corchetes al objeto headers
      const headers = req.headers as Record<string, string | string[] | undefined>;
      const headerAuditorId = headers['x-auditor-id'] || headers['X-Auditor-Id'];
      if (headerAuditorId) {
        auditorId = Array.isArray(headerAuditorId) ? headerAuditorId[0] : headerAuditorId;
        console.log('[AUDITOR-CONTROLLER] AuditorId de headers:', auditorId);
      }
    }

    // 3. Si no, del token (último recurso)
    if (!auditorId) {
      const headers = req.headers as Record<string, string | string[] | undefined>;
      const authHeader = headers['authorization'];
      if (authHeader) {
        console.log('[AUDITOR-CONTROLLER] Authorization header presente');
        // Aquí podrías decodificar el token JWT si fuera necesario
        // Por ahora, intentamos usar el username si está disponible
        if (user?.username) {
          console.log('[AUDITOR-CONTROLLER] Usando username como fallback:', user.username);
          // Buscar usuario por username para obtener id
          try {
            // Accede al repositorio si existe
            if (this.auditorService['userRepository']) {
              const usuarioRepo = this.auditorService['userRepository'];
              const usuario = await usuarioRepo.findOne({
                where: { username: user.username }
              });
              if (usuario) {
                auditorId = usuario.id;
                console.log('[AUDITOR-CONTROLLER] ID encontrado por username:', auditorId);
              }
            }
          } catch (error) {
            console.error('[AUDITOR-CONTROLLER] Error buscando usuario:', error);
          }
        }
      }
    }

    console.log('[AUDITOR-CONTROLLER] AuditorId final:', auditorId);
    console.log('[AUDITOR-CONTROLLER] ===========================');

    return this.auditorService.obtenerDocumentoParaVista(documentoId, auditorId);
  }

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

  async revisarDocumentoConArchivos(
    documentoId: string,
    auditorId: string,
    revisarDto: RevisarAuditorDocumentoDto,
    files: { [fieldname: string]: Express.Multer.File[] }
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {

    this.logger.log(`[BACKEND] Revisar con archivos: ${documentoId}, Estado: ${revisarDto.estado}`);

    // 1. Primero subir archivos si existen
    if (Object.keys(files).length > 0) {
      this.logger.log(`[BACKEND] Subiendo archivos...`);

      const subirDto: SubirDocumentosAuditorDto = {
        observaciones: revisarDto.observaciones || ''
      };

      await this.subirDocumentosAuditor(
        documentoId,
        auditorId,
        subirDto,
        files
      );

      this.logger.log(`[BACKEND] Archivos subidos`);
    }

    // 2. Luego realizar la revisión
    this.logger.log(`[BACKEND] Realizando revisión...`);
    return this.revisarDocumento(
      documentoId,
      auditorId,
      revisarDto
    );
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
      ],
      multerAuditorConfig,
    ),
  )
  async revisionCompleta(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
    @Body() body: any,
  ) {
    this.logger.log(`[REVISION-COMPLETA] Iniciando para documento ${documentoId}`);

    // 🔴 IMPORTANTE: Loggear todo para depuración
    console.log('====================================');
    console.log('[BACKEND REVISION-COMPLETA] LLEGÓ LA PETICIÓN');
    console.log(`Documento ID: ${documentoId}`);
    console.log(`Usuario ID: ${user?.id}`);
    console.log(`Body keys: ${Object.keys(body || {})}`);
    console.log(`Archivos recibidos: ${Object.keys(files || {}).length}`);
    console.log('====================================');

    // Si no hay body, intentar parsear desde FormData
    let estado = body.estado;
    let observaciones = body.observaciones;

    // Si viene de FormData y no está en body, puede venir como string
    if (!estado && body.data) {
      try {
        const parsedData = JSON.parse(body.data);
        estado = parsedData.estado;
        observaciones = parsedData.observaciones;
      } catch (e) {
        console.error('[BACKEND] Error parseando body.data:', e);
      }
    }

    // Validar estado
    if (!estado) {
      console.error('[BACKEND] Estado no encontrado en body:', body);
      throw new BadRequestException('Estado es requerido');
    }

    try {
      // Crear DTO
      const revisarDto = AuditorValidationHelper.crearDto({
        estado: estado,
        observaciones: observaciones || '',
        correcciones: body.correcciones
      });

      // Validar
      const validationErrors = AuditorValidationHelper.validateRevisarDto(revisarDto);
      if (validationErrors.length > 0) {
        throw new BadRequestException(validationErrors.join('; '));
      }

      this.logger.log(`[REVISION-COMPLETA] Procesando: ${revisarDto.estado}`);

      // ✅ 1. Subir archivos si existen
      if (files && Object.keys(files).length > 0) {
        console.log(`[BACKEND] Subiendo ${Object.keys(files).length} archivos...`);

        const subirDto: SubirDocumentosAuditorDto = {
          observaciones: observaciones || ''
        };

        await this.auditorService.subirDocumentosAuditor(
          documentoId,
          user.id,
          subirDto,
          files
        );

        console.log('[BACKEND] Archivos subidos exitosamente');
      }

      // ✅ 2. Realizar revisión
      console.log(`[BACKEND] Realizando revisión con estado: ${revisarDto.estado}`);

      return await this.auditorService.revisarDocumento(
        documentoId,
        user.id,
        revisarDto
      );

    } catch (error) {
      console.error('[BACKEND REVISION-COMPLETA ERROR] Detalles:', {
        message: error.message,
        stack: error.stack,
        body: body,
        files: Object.keys(files || {})
      });
      throw error;
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
}