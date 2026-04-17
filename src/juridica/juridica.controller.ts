import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { JuridicaService } from './juridica.service';
import { ContratistaService } from '../contratista/contratista.service'; // ✅ Importar
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { FiltrosContratoDto } from './dto/filtros-contrato.dto';
import { TipoDocumento } from './entities/documento-contrato.entity';

import { Response } from 'express';

@Controller('juridica')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR)
export class JuridicaController {
  private readonly logger = new Logger(JuridicaController.name);

  constructor(
    private readonly juridicaService: JuridicaService,
    private readonly bitacoraService: BitacoraSistemaService,
    private readonly contratistaService: ContratistaService, // ✅ Inyectar
  ) { }

  // ==================== CONTRATOS ====================

  @Post('contratos')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'minutaFile', maxCount: 1 },        // ← DEBE ESTAR
      { name: 'actaInicioFile', maxCount: 1 },    // ← DEBE ESTAR
      { name: 'cdpFile', maxCount: 1 },
      { name: 'rpFile', maxCount: 1 },
      { name: 'polizaCumplimientoFile', maxCount: 1 },
      { name: 'polizaCalidadFile', maxCount: 1 },
      { name: 'polizaRCFile', maxCount: 1 },
    ])
  )
  async createContrato(
    @Body('contrato') contratoStr: string,
    @UploadedFiles() files: {
      minutaFile?: Express.Multer.File[];
      actaInicioFile?: Express.Multer.File[];
      cdpFile?: Express.Multer.File[];
      rpFile?: Express.Multer.File[];
      polizaCumplimientoFile?: Express.Multer.File[];
      polizaCalidadFile?: Express.Multer.File[];
      polizaRCFile?: Express.Multer.File[];
    },
    @Req() req?: any,
  ) {
    try {
      const createContratoDto = JSON.parse(contratoStr);

      this.logger.log(`📝 Creando contrato: ${createContratoDto.numeroContrato}`);

      const contrato = await this.juridicaService.create(createContratoDto, files);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_CREAR_USUARIO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Contrato creado: ${contrato.numeroContrato}`,
          contratoId: contrato.id,
        },
        req,
      );

      return {
        success: true,
        message: 'Contrato creado exitosamente',
        data: contrato,
      };
    } catch (error) {
      this.logger.error(`❌ Error creando contrato: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('contratos')
  async findAllContratos(@Query() filtros: FiltrosContratoDto, @Req() req?: any) {
    try {
      this.logger.log(`📋 Listando contratos`);
      const contratos = await this.juridicaService.findAll(filtros);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Consulta lista de contratos (${contratos.length} registros)`,
        },
        req,
      );

      return {
        success: true,
        count: contratos.length,
        data: contratos,
      };
    } catch (error) {
      this.logger.error(`❌ Error listando contratos: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('contratos/:id')
  async findOneContrato(@Param('id') id: string, @Req() req?: any) {
    try {
      const contrato = await this.juridicaService.findOne(id);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Visualización de contrato: ${contrato.numeroContrato}`,
          contratoId: id,
        },
        req,
      );

      return {
        success: true,
        data: contrato,
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contrato ${id}: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Put('contratos/:id')
  async updateContrato(
    @Param('id') id: string,
    @Body() updateContratoDto: UpdateContratoDto,
    @Req() req?: any,
  ) {
    try {
      const contrato = await this.juridicaService.update(id, updateContratoDto);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Contrato actualizado: ${contrato.numeroContrato}`,
          contratoId: id,
        },
        req,
      );

      return {
        success: true,
        message: 'Contrato actualizado exitosamente',
        data: contrato,
      };
    } catch (error) {
      this.logger.error(`❌ Error actualizando contrato ${id}: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('contratos/:id/estado')
  async cambiarEstadoContrato(
    @Param('id') id: string,
    @Body() cambiarEstadoDto: CambiarEstadoDto,
    @Req() req?: any,
  ) {
    try {
      const contrato = await this.juridicaService.cambiarEstado(id, cambiarEstadoDto);

      await this.bitacoraService.registrar(
        AccionBitacora.JURIDICA_APROBAR,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Estado del contrato ${contrato.numeroContrato} cambiado a ${cambiarEstadoDto.estado}`,
          contratoId: id,
          metadata: { estadoAnterior: contrato.estado, estadoNuevo: cambiarEstadoDto.estado },
        },
        req,
      );

      return {
        success: true,
        message: `Estado del contrato cambiado a ${cambiarEstadoDto.estado}`,
        data: contrato,
      };
    } catch (error) {
      this.logger.error(`❌ Error cambiando estado contrato ${id}: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== BÚSQUEDA DE CONTRATISTA ====================

  @Get('contratistas/buscar-por-contrato/:numeroContrato')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR)
  async buscarContratistaPorNumeroContrato(
    @Param('numeroContrato') numeroContrato: string,
    @Req() req?: any
  ) {
    try {
      this.logger.log(`🔍 Buscando contratista por número de contrato: ${numeroContrato}`);

      // ✅ Usar el servicio de contratistas
      const contratista = await this.contratistaService.buscarPorNumeroContratoExacto(numeroContrato);

      return {
        ok: true,
        data: {
          success: true,
          data: contratista
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contratista: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  // ==================== PÓLIZAS ====================

  @Post('contratos/:contratoId/polizas')
  async agregarPoliza(
    @Param('contratoId') contratoId: string,
    @Body() createPolizaDto: any,
    @Req() req?: any,
  ) {
    try {
      const poliza = await this.juridicaService.agregarPoliza(contratoId, createPolizaDto);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Póliza agregada al contrato ${contratoId}`,
          metadata: { polizaId: poliza.id, tipoPoliza: poliza.tipoPoliza },
        },
        req,
      );

      return {
        success: true,
        message: 'Póliza agregada exitosamente',
        data: poliza,
      };
    } catch (error) {
      this.logger.error(`❌ Error agregando póliza: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('polizas/:polizaId/aprobar')
  async aprobarPoliza(
    @Param('polizaId') polizaId: string,
    @Body('usuario') usuario: string,
    @Req() req?: any,
  ) {
    try {
      const poliza = await this.juridicaService.aprobarPoliza(polizaId, usuario || 'Sistema');

      await this.bitacoraService.registrar(
        AccionBitacora.JURIDICA_APROBAR,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Póliza ${poliza.numeroPoliza} aprobada`,
          metadata: { polizaId, tipoPoliza: poliza.tipoPoliza },
        },
        req,
      );

      return {
        success: true,
        message: 'Póliza aprobada exitosamente',
        data: poliza,
      };
    } catch (error) {
      this.logger.error(`❌ Error aprobando póliza: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== MODIFICACIONES ====================

  @Post('modificaciones')
  async crearModificacion(@Body() createModificacionDto: any, @Req() req?: any) {
    try {
      const modificacion = await this.juridicaService.crearModificacion(createModificacionDto);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Modificación creada para contrato ${createModificacionDto.contratoId}`,
          metadata: { modificacionId: modificacion.id, tipo: modificacion.tipoModificacion },
        },
        req,
      );

      return {
        success: true,
        message: 'Modificación creada exitosamente',
        data: modificacion,
      };
    } catch (error) {
      this.logger.error(`❌ Error creando modificación: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== DOCUMENTOS ====================

  @Post('contratos/:contratoId/documentos')
@UseInterceptors(FileInterceptor('file'))
async subirDocumento(
  @Param('contratoId') contratoId: string,
  @UploadedFile() file: Express.Multer.File,
  @Body('tipoDocumento') tipoDocumento: TipoDocumento,
  @Body('descripcion') descripcion: string,
  @Body('usuario') usuario: string,
  @Req() req?: any,
) {
  try {
    if (!file) {
      throw new BadRequestException('Debe adjuntar un archivo');
    }

    // ✅ CORREGIDO: usar subirDocumentoContrato en lugar de subirDocumento
    const documento = await this.juridicaService.subirDocumentoContrato(
      contratoId,
      file,
      tipoDocumento,
      descripcion,
      usuario || 'Sistema',
    );

    await this.bitacoraService.registrar(
      AccionBitacora.DESCARGAR_ARCHIVO,
      ModuloBitacora.JURIDICA,
      req.user,
      undefined,
      {
        detalles: `Documento subido al contrato ${contratoId}: ${file.originalname}`,
        metadata: { tipoDocumento, nombreArchivo: file.originalname },
      },
      req,
    );

    return {
      success: true,
      message: 'Documento subido exitosamente',
      data: documento,
    };
  } catch (error) {
    this.logger.error(`❌ Error subiendo documento: ${error.message}`);
    throw new HttpException(
      { success: false, message: error.message },
      error.status || HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}


  // ==================== DASHBOARD Y REPORTES ====================

  @Get('dashboard/gerencial')
  async obtenerDashboardGerencial(@Req() req?: any) {
    try {
      const dashboard = await this.juridicaService.obtenerDashboardGerencial();

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        {
          detalles: `Dashboard gerencial consultado`,
        },
        req,
      );

      return {
        success: true,
        data: dashboard,
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo dashboard: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('alertas')
  async obtenerAlertas(@Req() req?: any) {
    try {
      const alertas = await this.juridicaService.obtenerAlertas();

      return {
        success: true,
        count: alertas.length,
        data: alertas,
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo alertas: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== HEALTH CHECK ====================

  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'juridica',
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async getAllContratos(@Query() filtros: FiltrosContratoDto, @Req() req?: any) {
    try {
      this.logger.log(`📋 Listando contratos (raíz)`);
      const contratos = await this.juridicaService.findAll(filtros);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.JURIDICA,
        req.user,
        undefined,
        { detalles: `Consulta lista de contratos (${contratos.length} registros)` },
        req,
      );

      return {
        success: true,
        count: contratos.length,
        data: contratos,
      };
    } catch (error) {
      this.logger.error(`❌ Error listando contratos: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('verificar/permisos')
  async verificarPermisos(@Req() req?: any) {
    const role = req.user?.role;
    return {
      success: true,
      data: {
        puedeCrear: role === UserRole.ADMIN || role === UserRole.JURIDICA,
        puedeVer: true,
        usuario: req.user
      }
    };
  }

  @Get('contratos/:id/documentos')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR)
  async obtenerDocumentosContrato(
    @Param('id') id: string,
    @Req() req?: any
  ) {
    try {
      this.logger.log(`📄 Obteniendo documentos del contrato: ${id}`);

      // Obtener el contrato primero para verificar que existe
      const contrato = await this.juridicaService.findOne(id);

      if (!contrato) {
        return {
          success: false,
          message: 'Contrato no encontrado',
          data: []
        };
      }

      // Los documentos ya vienen incluidos en la relación del contrato
      const documentos = contrato.documentos || [];

      this.logger.log(`✅ ${documentos.length} documentos encontrados para el contrato ${id}`);

      return {
        success: true,
        data: documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos del contrato ${id}: ${error.message}`);
      return {
        success: false,
        message: error.message,
        data: []
      };
    }
  }

  @Get('contrato-con-contratista/:numeroContrato')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR, UserRole.RADICADOR)
  async obtenerContratoYContratistaPorNumero(
    @Param('numeroContrato') numeroContrato: string,
    @Req() req?: any
  ) {
    try {
      this.logger.log(`🔍 Buscando contrato y contratista por número: "${numeroContrato}"`);

      // ✅ 1. Buscar el CONTRATO en jurídica por número
      const contrato = await this.juridicaService.buscarContratoPorNumero(numeroContrato);

      // ✅ 2. Buscar el CONTRATISTA por número de contrato
      const contratista = await this.contratistaService.buscarPorNumeroContratoExacto(numeroContrato);

      this.logger.log(`📊 Resultado - Contrato: ${contrato ? 'Encontrado' : 'No encontrado'}`);
      this.logger.log(`📊 Resultado - Contratista: ${contratista ? 'Encontrado' : 'No encontrado'}`);

      if (contrato) {
        this.logger.log(`📅 Fechas del contrato: ${contrato.fechaInicio} a ${contrato.fechaTerminacion}`);
      }

      // ✅ 3. Construir respuesta combinada
      const resultado = {
        contratista: contratista ? {
          id: contratista.id,
          nombre: contratista.razonSocial,
          documento: contratista.documentoIdentidad,
          numeroContrato: contratista.numeroContrato
        } : null,
        contrato: contrato ? {
          fechaInicio: contrato.fechaInicio,
          fechaFin: contrato.fechaTerminacion,
          fechaFirma: contrato.fechaFirma,
          objeto: contrato.objeto,
          valor: contrato.valor,
          estado: contrato.estado
        } : null
      };

      return {
        ok: true,
        data: {
          success: true,
          data: resultado
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contrato y contratista: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  @Get('contratos/numero/:numeroContrato')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR, UserRole.RADICADOR)
  async findContratoByNumero(@Param('numeroContrato') numeroContrato: string, @Req() req?: any) {
    try {
      this.logger.log(`🔍 Buscando contrato por número: ${numeroContrato}`);

      const contrato = await this.juridicaService.buscarContratoPorNumero(numeroContrato);

      if (!contrato) {
        return {
          success: false,
          message: `Contrato ${numeroContrato} no encontrado`,
          data: null
        };
      }

      // Cargar documentos del contrato
      const documentos = await this.juridicaService.obtenerDocumentosContrato(contrato.id);

      const resultado = {
        ...contrato,
        documentos: documentos || []
      };

      return {
        success: true,
        data: resultado
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contrato: ${error.message}`);
      return {
        success: false,
        message: error.message,
        data: null
      };
    }
  }

  @Post('contratos/:contratoId/documentos/rp-cdp')
  @UseInterceptors(FilesInterceptor('archivos', 2))
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR)
  async subirDocumentosRPCdp(
    @Param('contratoId') contratoId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('tipoDocumento') tipoDocumento: string,
    @Body('descripcion') descripcion: string,
    @Body('usuario') usuario: string,
    @Req() req?: any,
  ) {
    try {
      this.logger.log(`📄 Subiendo documentos RP/CDP para contrato ${contratoId}`);

      if (!files || files.length === 0) {
        throw new BadRequestException('Debe adjuntar al menos un archivo');
      }

      const tipos = JSON.parse(tipoDocumento);
      const resultados = [];

      for (let i = 0; i < files.length; i++) {
        const documento = await this.juridicaService.subirDocumentoContrato(
          contratoId,
          files[i],
          tipos[i] as TipoDocumento,
          descripcion || '',
          usuario || req.user?.email || 'Sistema',
        );

        // Actualizar el contrato con el número si es necesario
        if (tipos[i] === 'RP') {
          // Opcional: actualizar el campo rp del contrato
          await this.juridicaService.actualizarCampoRpCdp(contratoId, 'rp', documento.rutaArchivo);
        } else if (tipos[i] === 'CDP') {
          await this.juridicaService.actualizarCampoRpCdp(contratoId, 'cdp', documento.rutaArchivo);
        }

        resultados.push(documento);
      }

      return {
        success: true,
        message: `${resultados.length} documento(s) subido(s) exitosamente`,
        data: resultados,
      };
    } catch (error) {
      this.logger.error(`❌ Error subiendo documentos RP/CDP: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('contratos/documentos/:documentoId/previsualizar')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR, UserRole.RADICADOR)
  async previsualizarDocumentoContrato(
    @Param('documentoId') documentoId: string,
    @Res() res: Response, // ✅ Usar Response de express
    @Req() req?: any,
  ) {
    try {
      const { buffer, nombre, mimeType } = await this.juridicaService.previsualizarDocumentoContrato(documentoId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error previsualizando documento: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          success: false,
          message: error.message,
        });
      }
    }
  }

  @Get('contratos/documentos/:documentoId/descargar')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR, UserRole.RADICADOR)
  async descargarDocumentoContrato(
    @Param('documentoId') documentoId: string,
    @Res() res: Response,
    @Req() req?: any,
  ) {
    try {
      const { buffer, nombre, mimeType } = await this.juridicaService.descargarDocumentoContrato(documentoId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando documento: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          success: false,
          message: error.message,
        });
      }
    }
  }
}