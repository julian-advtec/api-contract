// src/modules/contabilidad/controllers/contabilidad-stats.controller.ts
import { Controller, Get, Query, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiQuery, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ContabilidadStatsService, EstadisticasContabilidad, FiltrosEstadisticas } from './contabilidad-stats.service';
import { ContabilidadEstado, TipoCausacion } from './entities/contabilidad-documento.entity';

// Tipo que coincide exactamente con lo que devuelve JwtStrategy.validate()
type JwtUser = {
    id: string;
    username: string;
    role: string;
    email: string;
    fullName?: string;
};

@ApiTags('Estadísticas Contabilidad')
@ApiBearerAuth()
@Controller('contabilidad/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CONTABILIDAD, UserRole.ADMIN)
export class ContabilidadStatsController {
    constructor(private readonly statsService: ContabilidadStatsService) { }

    @Get('generales')
    @ApiOperation({ summary: 'Obtener estadísticas generales de contabilidad' })
    @ApiQuery({ name: 'fechaInicio', required: false, type: Date })
    @ApiQuery({ name: 'fechaFin', required: false, type: Date })
    @ApiQuery({ name: 'contadorId', required: false, type: String })
    @ApiQuery({ name: 'estado', required: false, enum: ContabilidadEstado })
    @ApiQuery({ name: 'tipoCausacion', required: false, enum: TipoCausacion })
    @ApiQuery({ name: 'tieneGlosa', required: false, type: Boolean })
    async getEstadisticasGenerales(
        @GetUser() user: JwtUser,
        @Query('fechaInicio') fechaInicio?: Date,
        @Query('fechaFin') fechaFin?: Date,
        @Query('contadorId') contadorId?: string,
        @Query('estado') estado?: ContabilidadEstado,
        @Query('tipoCausacion') tipoCausacion?: TipoCausacion,
        @Query('tieneGlosa') tieneGlosa?: boolean,
    ): Promise<{ success: boolean; data: EstadisticasContabilidad }> {
        const filtros: FiltrosEstadisticas = {
            fechaInicio,
            fechaFin,
            contadorId,
            estado,
            tipoCausacion,
            tieneGlosa: tieneGlosa !== undefined ? JSON.parse(tieneGlosa.toString()) : undefined
        };

        const data = await this.statsService.getEstadisticasGenerales(
            user.id,
            user.role,
            filtros
        );

        return {
            success: true,
            data
        };
    }

    @Get('contador/:contadorId')
    @ApiOperation({ summary: 'Obtener estadísticas específicas de un contador' })
    @ApiQuery({ name: 'fechaInicio', required: false, type: Date })
    @ApiQuery({ name: 'fechaFin', required: false, type: Date })
    async getEstadisticasPorContador(
        @Param('contadorId', ParseUUIDPipe) contadorId: string,
        @GetUser() user: JwtUser,
        @Query('fechaInicio') fechaInicio?: Date,
        @Query('fechaFin') fechaFin?: Date,
    ) {
        // Solo admin puede ver estadísticas de otros contadores
        if (user.role !== UserRole.ADMIN && user.role && user.id !== contadorId) {
            throw new Error('No tienes permisos para ver estas estadísticas');
        }

        const filtros: FiltrosEstadisticas = {
            fechaInicio,
            fechaFin
        };

        const data = await this.statsService.getEstadisticasPorContador(contadorId, filtros);

        return {
            success: true,
            data
        };
    }

    @Get('mi-estadistica')
    @ApiOperation({ summary: 'Obtener mis estadísticas personales' })
    async getMiEstadistica(@GetUser() user: JwtUser) {
        const data = await this.statsService.getEstadisticasPorContador(user.id, {});

        return {
            success: true,
            data
        };
    }

    @Get('estado/:estado')
    @ApiOperation({ summary: 'Obtener documentos por estado específico' })
    async getDocumentosPorEstado(
        @Param('estado') estado: ContabilidadEstado,
        @GetUser() user: JwtUser
    ) {
        const data = await this.statsService.getDocumentosPorEstado(estado, user.id, user.role);

        return {
            success: true,
            count: data.length,
            data
        };
    }

    @Get('metricas-tiempo')
    @ApiOperation({ summary: 'Obtener métricas de tiempo de revisión' })
    async getMetricasTiempo(@GetUser() user: JwtUser) {
        const data = await this.statsService.getMetricasTiempo(user.id, user.role);

        return {
            success: true,
            data
        };
    }

    @Get('resumen-rapido')
    @ApiOperation({ summary: 'Obtener resumen rápido para dashboard' })
    async getResumenRapido(@GetUser() user: JwtUser) {
        const estadisticas = await this.statsService.getEstadisticasGenerales(user.id, user.role, {
            fechaInicio: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // últimos 30 días
        });

        // Extraer solo lo necesario para un resumen rápido
        const resumen = {
            totalDocumentos: estadisticas.resumen.totalDocumentos,
            completados: estadisticas.resumen.documentosCompletados,
            enRevision: estadisticas.resumen.documentosEnRevision,
            tasaCompletitud: estadisticas.resumen.totalDocumentos > 0 ?
                (estadisticas.resumen.documentosCompletados / estadisticas.resumen.totalDocumentos) * 100 : 0,
            tiempoPromedio: estadisticas.tiempos.promedioRevision,
            conGlosa: estadisticas.glosas.conGlosa,
            documentosRecientes: estadisticas.documentosRecientes.slice(0, 5)
        };

        return {
            success: true,
            data: resumen
        };
    }
}