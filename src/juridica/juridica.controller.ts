// src/juridica/juridica.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JuridicaService } from './juridica.service';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { CreatePolizaDto } from './dto/create-poliza.dto';
import { CreateModificacionDto } from './dto/create-modificacion.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { FiltrosContratoDto } from './dto/filtros-contrato.dto';
import { TipoDocumento } from './entities/documento-contrato.entity';

@Controller('juridica')
export class JuridicaController {
  private readonly logger = new Logger(JuridicaController.name);

  constructor(private readonly juridicaService: JuridicaService) {}

  // ==================== CONTRATOS ====================

  @Post('contratos')
  async createContrato(@Body() createContratoDto: CreateContratoDto) {
    try {
      this.logger.log(`📝 Creando contrato: ${createContratoDto.numeroContrato}`);
      const contrato = await this.juridicaService.create(createContratoDto);
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
  async findAllContratos(@Query() filtros: FiltrosContratoDto) {
    try {
      this.logger.log(`📋 Listando contratos`);
      const contratos = await this.juridicaService.findAll(filtros);
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
  async findOneContrato(@Param('id') id: string) {
    try {
      const contrato = await this.juridicaService.findOne(id);
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
  ) {
    try {
      const contrato = await this.juridicaService.update(id, updateContratoDto);
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
  ) {
    try {
      const contrato = await this.juridicaService.cambiarEstado(id, cambiarEstadoDto);
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
    @Body() createPolizaDto: CreatePolizaDto,
  ) {
    try {
      const poliza = await this.juridicaService.agregarPoliza(contratoId, createPolizaDto);
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
  ) {
    try {
      const poliza = await this.juridicaService.aprobarPoliza(polizaId, usuario || 'Sistema');
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
  async crearModificacion(@Body() createModificacionDto: CreateModificacionDto) {
    try {
      const modificacion = await this.juridicaService.crearModificacion(createModificacionDto);
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
  async obtenerDashboardGerencial() {
    try {
      const dashboard = await this.juridicaService.obtenerDashboardGerencial();
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
  async obtenerAlertas() {
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
      endpoints: [
        'POST /juridica/contratos',
        'GET /juridica/contratos',
        'GET /juridica/contratos/:id',
        'PUT /juridica/contratos/:id',
        'PATCH /juridica/contratos/:id/estado',
        'POST /juridica/contratos/:contratoId/polizas',
        'PATCH /juridica/polizas/:polizaId/aprobar',
        'POST /juridica/modificaciones',
        'POST /juridica/contratos/:contratoId/documentos',
        'GET /juridica/dashboard/gerencial',
        'GET /juridica/alertas',
      ],
    };
  }
}