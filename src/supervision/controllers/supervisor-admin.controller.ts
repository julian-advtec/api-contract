import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { SupervisorDocumentosService } from '../services/supervisor-documentos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('supervisor/admin')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.ADMIN)
export class SupervisorAdminController {
  private readonly logger = new Logger(SupervisorAdminController.name);

  constructor(
    private readonly supervisorDocumentosService: SupervisorDocumentosService,
  ) {}

  // ===============================
  // ASIGNAR TODOS LOS DOCUMENTOS
  // ===============================
  @Post('asignar-todos')
  async asignarTodosDocumentos(@Req() req: Request) {
    const user = (req as any).user;
    this.logger.log(`👑 Admin ${user.username} forzando asignación de TODOS los documentos a supervisores`);

    try {
      const resultado = await this.supervisorDocumentosService.asignarTodosDocumentosASupervisores();

      return {
        success: true,
        message: `Asignación completada: ${resultado.asignados} de ${resultado.total} documentos asignados`,
        data: resultado
      };
    } catch (error) {
      this.logger.error(`❌ Error asignando todos los documentos: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al asignar documentos a supervisores'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // HEALTH CHECK
  // ===============================
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      service: 'supervisor',
      status: 'operational',
      timestamp: new Date().toISOString()
    };
  }

  // ===============================
  // DIAGNÓSTICO COMPLETO
  // ===============================
  @Get('diagnostico')
  async diagnostico(@Req() req: Request) {
    const user = (req as any).user;
    this.logger.log(`🔍 ${user.role} ${user.username} ejecutando diagnóstico`);

    try {
      // Obtener conteos básicos
      const totalDocumentosRadicados = await this.supervisorDocumentosService.obtenerConteoDocumentosRadicados();
      const estadosDistintos = await this.supervisorDocumentosService['documentoRepository']
        .createQueryBuilder('doc')
        .select('doc.estado', 'estado')
        .addSelect('COUNT(*)', 'cantidad')
        .groupBy('doc.estado')
        .orderBy('cantidad', 'DESC')
        .getRawMany();

      return {
        success: true,
        timestamp: new Date().toISOString(),
        usuario: {
          username: user.username,
          role: user.role,
        },
        conteos: {
          totalDocumentosRadicados,
          estadosDistintos
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en diagnóstico: ${error.message}`, error.stack);
      return {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }
}