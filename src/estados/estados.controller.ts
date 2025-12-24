// src/radicacion/estados/estados.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { EstadosService } from './estados.service';
import { AvanzarEstadoDto } from '../radicacion/dto/avanzar-estado.dto';
import { DevolverDocumentoDto } from '../radicacion/dto/devolver-documento.dto';

@Controller('radicacion/estados')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EstadosController {
  private readonly logger = new Logger(EstadosController.name);

  constructor(private readonly estadosService: EstadosService) {}

  @Get('asignados')
  async getDocumentosAsignados(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 Usuario ${user.username} solicitando documentos asignados`);
    
    const documentos = await this.estadosService.obtenerDocumentosAsignados(user);
    
    return {
      success: true,
      count: documentos.length,
      data: documentos,
    };
  }

  @Get('por-estado')
  async getDocumentosPorEstado(@Req() req: any, @Query('estado') estado?: string) {
    const user = req.user;
    this.logger.log(`📋 Usuario ${user.username} solicitando documentos por estado: ${estado || 'todos'}`);
    
    const documentos = await this.estadosService.obtenerDocumentosPorEstado(user, estado);
    
    return {
      success: true,
      count: documentos.length,
      data: documentos,
    };
  }

  @Post(':id/avanzar')
  @Roles(
    UserRole.SUPERVISOR,
    UserRole.AUDITOR_CUENTAS,
    UserRole.CONTABILIDAD,
    UserRole.TESORERIA,
    UserRole.ASESOR_GERENCIA,
    UserRole.RENDICION_CUENTAS,
    UserRole.RADICADOR,
    UserRole.ADMIN
  )
  async avanzarEstado(
    @Param('id') id: string,
    @Body() avanzarDto: AvanzarEstadoDto,
    @Req() req: any,
  ) {
    const user = req.user;
    this.logger.log(`➡️ Usuario ${user.username} avanzando documento ${id} a ${avanzarDto.estadoSiguiente}`);
    
    const documento = await this.estadosService.avanzarEstado(
      id,
      avanzarDto.estadoSiguiente,
      user,
      avanzarDto.observacion
    );
    
    return {
      success: true,
      message: `Documento avanzado a ${avanzarDto.estadoSiguiente}`,
      data: documento,
    };
  }

  @Post(':id/devolver')
  @Roles(
    UserRole.SUPERVISOR,
    UserRole.AUDITOR_CUENTAS,
    UserRole.CONTABILIDAD,
    UserRole.TESORERIA,
    UserRole.ASESOR_GERENCIA,
    UserRole.RENDICION_CUENTAS,
    UserRole.ADMIN
  )
  async devolverDocumento(
    @Param('id') id: string,
    @Body() devolverDto: DevolverDocumentoDto,
    @Req() req: any,
  ) {
    const user = req.user;
    this.logger.log(`↩️ Usuario ${user.username} devolviendo documento ${id}`);
    
    const documento = await this.estadosService.devolverDocumento(
      id,
      user,
      devolverDto.motivo,
      devolverDto.instruccionesCorreccion
    );
    
    return {
      success: true,
      message: 'Documento devuelto para correcciones',
      data: documento,
    };
  }

  @Post(':id/corregir')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async corregirDocumento(
    @Param('id') id: string,
    @Body() body: { observacion: string },
    @Req() req: any,
  ) {
    const user = req.user;
    this.logger.log(`🔧 Usuario ${user.username} corrigiendo documento ${id}`);
    
    const documento = await this.estadosService.corregirDocumento(id, user, body.observacion);
    
    return {
      success: true,
      message: 'Documento corregido exitosamente',
      data: documento,
    };
  }

  @Get(':id/historial')
  async getHistorial(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    this.logger.log(`📊 Usuario ${user.username} solicitando historial del documento ${id}`);
    
    const historial = await this.estadosService.obtenerHistorial(id, user);
    
    return {
      success: true,
      data: historial,
    };
  }

  @Get('estadisticas')
  async getEstadisticas(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📈 Usuario ${user.username} solicitando estadísticas`);
    
    const estadisticas = await this.estadosService.obtenerEstadisticas(user);
    
    return {
      success: true,
      data: estadisticas,
    };
  }

  @Get('configuracion')
  async getConfiguracion() {
    const configuracion = await this.estadosService.obtenerConfiguracionFlujo();
    
    return {
      success: true,
      data: configuracion,
    };
  }

  @Get('estados-disponibles')
  async getEstadosDisponibles(@Req() req: any) {
    const user = req.user;
    
    const estados = await this.estadosService.obtenerEstadosPermitidosPorRol(user.role as UserRole);
    
    return {
      success: true,
      data: {
        usuario: {
          nombre: user.fullName || user.username,
          rol: user.role,
        },
        estados: estados,
      },
    };
  }
}