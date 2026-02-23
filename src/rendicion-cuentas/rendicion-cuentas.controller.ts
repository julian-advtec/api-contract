// rendicion-cuentas.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';

import { RendicionCuentasService } from './rendicion-cuentas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { RendicionCuentasEstado } from './entities/rendicion-cuentas-estado.enum';

import {
  CreateRendicionCuentasDto,
  AsignarRendicionCuentasDto,
  IniciarRevisionDto,
  TomarDecisionDto,
  CompletarDto,
  FiltrosRendicionCuentasDto,
} from './dto/rendicion-cuentas.dto';

interface JwtUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string;
  email?: string;
}

@Controller('rendicion-cuentas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RendicionCuentasController {
  private readonly logger = new Logger(RendicionCuentasController.name);

  constructor(private readonly rendicionCuentasService: RendicionCuentasService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async create(@Body() createDto: CreateRendicionCuentasDto, @GetUser() user: JwtUser) {
    const result = await this.rendicionCuentasService.create(createDto, user);
    return {
      ok: true,
      message: 'Documento agregado a rendición de cuentas',
      data: result,
    };
  }

 // rendicion-cuentas.controller.ts
@Get()
@Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
async findAll(@Query() query: FiltrosRendicionCuentasDto) {
  try {
    const result = await this.rendicionCuentasService.findAll(query);
    return {
      ok: true,
      data: result.data,  // ← Asegurar que sea un array
      meta: { 
        total: result.total, 
        ...query 
      },
    };
  } catch (error) {
    this.logger.error(`Error en findAll: ${error.message}`, error.stack);
    return {
      ok: false,
      error: 'Error al obtener documentos',
      data: [],  // ← Siempre devolver array vacío en error
      meta: { total: 0 }
    };
  }
}

  @Get('mis-documentos')
  @Roles(UserRole.RENDICION_CUENTAS, UserRole.ADMIN)  // ← AGREGAR ADMIN
  async findMisDocumentos(@GetUser() user: JwtUser, @Query() query: any) {
    try {
      const filtros = {
        estados: query.estados?.split(','),
        desde: query.desde ? new Date(query.desde) : undefined,
        hasta: query.hasta ? new Date(query.hasta) : undefined,
      };
      const result = await this.rendicionCuentasService.findMisDocumentos(user, filtros);
      return {
        ok: true,
        data: result,
        meta: { total: result.length },
      };
    } catch (error) {
      this.logger.error(`Error en mis-documentos: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  @Get('pendientes')
  @Roles(UserRole.RENDICION_CUENTAS, UserRole.ADMIN)  // ← AGREGAR ADMIN
  async findPendientes(@GetUser() user: JwtUser) {
    try {
      const result = await this.rendicionCuentasService.findPendientes(user);
      return {
        ok: true,
        data: result,
        meta: { total: result.length },
      };
    } catch (error) {
      this.logger.error(`Error en pendientes: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  @Get('estadisticas')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS)
  async getEstadisticas(@GetUser() user: JwtUser, @Query() query: any) {
    try {
      const filtros = {
        desde: query.desde ? new Date(query.desde) : undefined,
        hasta: query.hasta ? new Date(query.hasta) : undefined,
      };
      const result = await this.rendicionCuentasService.obtenerEstadisticas(user, filtros);
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Error en estadisticas: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.rendicionCuentasService.findOne(id);
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Get(':id/historial')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async findHistorial(@Param('id') id: string) {
    try {
      const result = await this.rendicionCuentasService.findHistorial(id);
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Patch(':id/asignar')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async asignar(
    @Param('id') id: string, 
    @Body() asignarDto: AsignarRendicionCuentasDto, 
    @GetUser() user: JwtUser
  ) {
    try {
      const result = await this.rendicionCuentasService.asignar(id, asignarDto, user);
      return {
        ok: true,
        message: 'Documento asignado',
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Patch(':id/iniciar-revision')
  @Roles(UserRole.RENDICION_CUENTAS, UserRole.ADMIN)  // ← AGREGAR ADMIN
  async iniciarRevision(
    @Param('id') id: string, 
    @Body() iniciarDto: IniciarRevisionDto, 
    @GetUser() user: JwtUser
  ) {
    try {
      const result = await this.rendicionCuentasService.iniciarRevision(id, iniciarDto, user);
      return {
        ok: true,
        message: 'Revisión iniciada',
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Patch(':id/decision')
  @Roles(UserRole.RENDICION_CUENTAS, UserRole.ADMIN)  // ← AGREGAR ADMIN
  async tomarDecision(
    @Param('id') id: string, 
    @Body() decisionDto: TomarDecisionDto, 
    @GetUser() user: JwtUser
  ) {
    try {
      const result = await this.rendicionCuentasService.tomarDecision(id, decisionDto, user);
      
      const mensajes = {
        [RendicionCuentasEstado.APROBADO]: 'Documento aprobado',
        [RendicionCuentasEstado.OBSERVADO]: 'Observación registrada',
        [RendicionCuentasEstado.RECHAZADO]: 'Documento rechazado',
      };

      return {
        ok: true,
        message: mensajes[decisionDto.decision] || 'Decisión registrada',
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Patch(':id/completar')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async completar(
    @Param('id') id: string, 
    @Body() completarDto: CompletarDto, 
    @GetUser() user: JwtUser
  ) {
    try {
      const result = await this.rendicionCuentasService.completar(id, completarDto, user);
      return {
        ok: true,
        message: 'Proceso completado',
        data: result,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  @Get(':id/descargar-carpeta')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async descargarCarpeta(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      const rendicion = await this.rendicionCuentasService.findOne(id);
      const documentoRadicado = rendicion.documento;

      if (!documentoRadicado?.rutaCarpetaRadicado) {
        return res.status(404).json({ ok: false, message: 'No se encontró la ruta de la carpeta' });
      }

      const carpeta = documentoRadicado.rutaCarpetaRadicado;

      if (!fs.existsSync(carpeta) || !fs.statSync(carpeta).isDirectory()) {
        return res.status(404).json({ ok: false, message: 'La carpeta no existe' });
      }

      const archive = archiver('zip', { zlib: { level: 6 } });

      res.setHeader('Content-Type', 'application/zip');
      const nombreSeguro = documentoRadicado.numeroRadicado
        ? documentoRadicado.numeroRadicado.replace(/[^a-zA-Z0-9-]/g, '_')
        : `rendicion-${id}`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${nombreSeguro}.zip"`);

      archive.pipe(res);

      const archivos = fs.readdirSync(carpeta);

      for (const archivo of archivos) {
        const rutaCompleta = path.join(carpeta, archivo);
        const stat = fs.statSync(rutaCompleta);

        if (stat.isFile()) {
          const ext = path.extname(archivo).toLowerCase();
          if (ext !== '.txt') {
            archive.file(rutaCompleta, { name: archivo });
          }
        }
      }

      await archive.finalize();

    } catch (error) {
      this.logger.error('Error generando ZIP:', error);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, message: 'Error al generar el archivo ZIP' });
      }
    }
  }
}