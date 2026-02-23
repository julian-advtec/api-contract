// src/rendicion-cuentas/rendicion-cuentas.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpStatus,
} from '@nestjs/common';

import { RendicionCuentasService } from './rendicion-cuentas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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

@Controller('rendicion-cuentas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RendicionCuentasController {
  constructor(private readonly rendicionCuentasService: RendicionCuentasService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async create(@Body() createDto: CreateRendicionCuentasDto, @Req() req: any) {
    const result = await this.rendicionCuentasService.create(createDto, req.user);
    return {
      ok: true,
      message: 'Documento agregado a rendición de cuentas',
      data: result,
    };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async findAll(@Query() query: FiltrosRendicionCuentasDto) {
    const result = await this.rendicionCuentasService.findAll(query);
    return {
      ok: true,
      data: result.data,
      meta: { total: result.total, ...query },
    };
  }

  @Get('mis-documentos')
  @Roles(UserRole.RENDICION_CUENTAS)
  async findMisDocumentos(@Req() req: any, @Query() query: any) {
    const filtros = {
      estados: query.estados?.split(','),
      desde: query.desde ? new Date(query.desde) : undefined,
      hasta: query.hasta ? new Date(query.hasta) : undefined,
    };

    const result = await this.rendicionCuentasService.findMisDocumentos(req.user, filtros);
    return {
      ok: true,
      data: result,
      meta: { total: result.length },
    };
  }

  @Get('pendientes')
  @Roles(UserRole.RENDICION_CUENTAS)
  async findPendientes(@Req() req: any) {
    const result = await this.rendicionCuentasService.findPendientes(req.user);
    return {
      ok: true,
      data: result,
      meta: { total: result.length },
    };
  }

  @Get('estadisticas')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS)
  async getEstadisticas(@Req() req: any, @Query() query: any) {
    const filtros = {
      desde: query.desde ? new Date(query.desde) : undefined,
      hasta: query.hasta ? new Date(query.hasta) : undefined,
    };

    const result = await this.rendicionCuentasService.obtenerEstadisticas(req.user, filtros);
    return {
      ok: true,
      data: result,
    };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async findOne(@Param('id') id: string) {
    const result = await this.rendicionCuentasService.findOne(id);
    return {
      ok: true,
      data: result,
    };
  }

  @Get(':id/historial')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async findHistorial(@Param('id') id: string) {
    const result = await this.rendicionCuentasService.findHistorial(id);
    return {
      ok: true,
      data: result,
    };
  }

  @Patch(':id/asignar')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async asignar(@Param('id') id: string, @Body() asignarDto: AsignarRendicionCuentasDto, @Req() req: any) {
    const result = await this.rendicionCuentasService.asignar(id, asignarDto, req.user);
    return {
      ok: true,
      message: 'Documento asignado',
      data: result,
    };
  }

  @Patch(':id/iniciar-revision')
  @Roles(UserRole.RENDICION_CUENTAS)
  async iniciarRevision(@Param('id') id: string, @Body() iniciarDto: IniciarRevisionDto, @Req() req: any) {
    const result = await this.rendicionCuentasService.iniciarRevision(id, iniciarDto, req.user);
    return {
      ok: true,
      message: 'Revisión iniciada',
      data: result,
    };
  }

  @Patch(':id/decision')
  @Roles(UserRole.RENDICION_CUENTAS)
  async tomarDecision(@Param('id') id: string, @Body() decisionDto: TomarDecisionDto, @Req() req: any) {
    const result = await this.rendicionCuentasService.tomarDecision(id, decisionDto, req.user);
    
    const mensajes = {
      [RendicionCuentasEstado.APROBADO]: 'Documento aprobado',
      [RendicionCuentasEstado.OBSERVADO]: 'Observación registrada',
      [RendicionCuentasEstado.RECHAZADO]: 'Documento rechazado',
    };

    return {
      ok: true,
      message: mensajes[decisionDto.decision],
      data: result,
    };
  }

  @Patch(':id/completar')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async completar(@Param('id') id: string, @Body() completarDto: CompletarDto, @Req() req: any) {
    const result = await this.rendicionCuentasService.completar(id, completarDto, req.user);
    return {
      ok: true,
      message: 'Proceso completado',
      data: result,
    };
  }
}