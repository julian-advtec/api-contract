// src/juridica/juridica.controller.ts
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
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { JuridicaService } from './juridica.service';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { FiltrosContratoDto } from './dto/filtros-contrato.dto';
import { TipoDocumento } from './entities/documento-contrato.entity';

@Controller('juridica')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.JURIDICA, UserRole.SUPERVISOR)
export class JuridicaController {
  private readonly logger = new Logger(JuridicaController.name);

  constructor(
    private readonly juridicaService: JuridicaService,
    private readonly bitacoraService: BitacoraSistemaService,
  ) { }

  // ==================== CONTRATOS ====================

  @Post('contratos')
  async createContrato(@Body() createContratoDto: CreateContratoDto, @Req() req?: any) {
    try {
      this.logger.log(`📝 Creando contrato: ${createContratoDto.numeroContrato}`);
      const contrato = await this.juridicaService.create(createContratoDto);

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

      const documento = await this.juridicaService.subirDocumento(
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
}