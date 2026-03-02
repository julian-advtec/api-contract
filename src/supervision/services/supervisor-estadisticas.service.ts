import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, IsNull, And } from 'typeorm';

import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { PeriodoEstadisticasSupervisor } from '../dto/supervisor-estadisticas-query.dto';

@Injectable()
export class SupervisorEstadisticasService {
  private readonly logger = new Logger(SupervisorEstadisticasService.name);

  constructor(
    @InjectRepository(SupervisorDocumento)
    private supervisorRepository: Repository<SupervisorDocumento>,

    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) { }

  async obtenerHistorialSupervisor(supervisorId: string): Promise<any[]> {
    const supervisorDocs = await this.supervisorRepository.find({
      where: { supervisor: { id: supervisorId } },
      relations: ['documento', 'documento.radicador'],
      order: { fechaActualizacion: 'DESC' },
      take: 50,
    });

    this.logger.debug(`Historial encontrado: ${supervisorDocs.length} registros`);

    return supervisorDocs.map((sd) => ({
      id: sd.id,
      documento: {
        id: sd.documento.id,
        numeroRadicado: sd.documento.numeroRadicado,
        nombreContratista: sd.documento.nombreContratista,
        documentoContratista: sd.documento.documentoContratista,
        numeroContrato: sd.documento.numeroContrato,
        fechaInicio: sd.documento.fechaInicio,
        fechaFin: sd.documento.fechaFin,
        fechaRadicacion: sd.documento.fechaRadicacion,
        estado: sd.documento.estado,
        cuentaCobro: sd.documento.cuentaCobro,
        seguridadSocial: sd.documento.seguridadSocial,
        informeActividades: sd.documento.informeActividades,
        observacion: sd.documento.observacion,
        nombreRadicador: sd.documento.nombreRadicador,
      },
      supervisorRevisor: sd.supervisor?.fullName || sd.supervisor?.username,
      estado: sd.estado,
      observacion: sd.observacion,
      correcciones: sd.correcciones || '',
      fechaCreacion: sd.fechaCreacion,
      fechaActualizacion: sd.fechaActualizacion,
      fechaAprobacion: sd.fechaAprobacion,
      tieneArchivo: !!sd.nombreArchivoSupervisor,
      nombreArchivoSupervisor: sd.nombreArchivoSupervisor,
      tienePazSalvo: !!sd.pazSalvo,
      pazSalvo: sd.pazSalvo,
    }));
  }

  async obtenerEstadisticasSupervisor(
    supervisorId: string,
    periodo: PeriodoEstadisticasSupervisor = PeriodoEstadisticasSupervisor.ANO
  ): Promise<any> {
    console.log('========== DEBUG SERVICE ==========');
    console.log('📥 Período recibido en SERVICE:', periodo);
    console.log('📥 Supervisor ID:', supervisorId);
    
    const ahora = new Date();
    let desde: Date;

    switch (periodo) {
      case PeriodoEstadisticasSupervisor.HOY:
        desde = new Date(ahora);
        desde.setHours(0, 0, 0, 0);
        console.log('📅 Calculando para HOY');
        break;

      case PeriodoEstadisticasSupervisor.SEMANA:
        desde = new Date(ahora);
        desde.setDate(ahora.getDate() - 7);
        desde.setHours(0, 0, 0, 0);
        console.log('📅 Calculando para SEMANA (últimos 7 días)');
        break;

      case PeriodoEstadisticasSupervisor.MES:
        desde = new Date(ahora);
        desde.setMonth(ahora.getMonth() - 1);
        desde.setHours(0, 0, 0, 0);
        console.log('📅 Calculando para MES (últimos 30 días)');
        break;

      case PeriodoEstadisticasSupervisor.TRIMESTRE:
        desde = new Date(ahora);
        desde.setMonth(ahora.getMonth() - 3);
        desde.setHours(0, 0, 0, 0);
        console.log('📅 Calculando para TRIMESTRE (últimos 90 días)');
        break;

      case PeriodoEstadisticasSupervisor.ANO:
      default:
        desde = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
        console.log('📅 Calculando para AÑO (desde 01/01 hasta ahora)');
        break;
    }

    const hasta = new Date(ahora);
    console.log(`📊 Rango final: ${desde.toISOString()} → ${hasta.toISOString()}`);
    console.log('====================================');

    try {
      // 1. Total aprobados en el período (por fechaAprobacion)
      const aprobados = await this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.APROBADO,
          fechaAprobacion: And(Not(IsNull()), Between(desde, hasta)),
        },
      });

      // 2. Observados en el período
      const observados = await this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.OBSERVADO,
          fechaAprobacion: And(Not(IsNull()), Between(desde, hasta)),
        },
      });

      // 3. Rechazados en el período
      const rechazados = await this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.RECHAZADO,
          fechaAprobacion: And(Not(IsNull()), Between(desde, hasta)),
        },
      });

      // 4. En revisión (sin fechaAprobacion, usamos fechaCreacion)
      const enRevision = await this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION,
          fechaCreacion: Between(desde, hasta),
        },
      });

      // 5. Total procesados (para eficiencia)
      const totalProcesados = aprobados + observados + rechazados;

      // 6. Eficiencia
      const eficiencia = totalProcesados > 0 ? Math.round((aprobados / totalProcesados) * 100) : 0;

      // 7. Tiempo promedio aprobación (solo aprobados en período)
      const aprobadosCompletos = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.APROBADO,
          fechaAprobacion: And(Not(IsNull()), Between(desde, hasta)),
        },
        select: ['fechaCreacion', 'fechaAprobacion'],
      });

      let tiempoPromedioHoras = 0;
      if (aprobadosCompletos.length > 0) {
        const totalHoras = aprobadosCompletos.reduce((total, doc) => {
          const inicio = new Date(doc.fechaCreacion!);
          const fin = new Date(doc.fechaAprobacion!);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return total + horas;
        }, 0);
        tiempoPromedioHoras = Math.round(totalHoras / aprobadosCompletos.length);
      }

      // 8. Distribución por estado (para la barra de progreso)
      const distribucion = [
        {
          estado: 'Aprobados',
          cantidad: aprobados,
          porcentaje: totalProcesados > 0 ? Math.round((aprobados / totalProcesados) * 100) : 0,
          color: '#4CAF50'
        },
        {
          estado: 'Observados',
          cantidad: observados,
          porcentaje: totalProcesados > 0 ? Math.round((observados / totalProcesados) * 100) : 0,
          color: '#FF9800'
        },
        {
          estado: 'Rechazados',
          cantidad: rechazados,
          porcentaje: totalProcesados > 0 ? Math.round((rechazados / totalProcesados) * 100) : 0,
          color: '#F44336'
        },
        {
          estado: 'En Revisión',
          cantidad: enRevision,
          porcentaje: totalProcesados > 0 ? Math.round((enRevision / totalProcesados) * 100) : 0,
          color: '#2196F3'
        }
      ].filter(item => item.cantidad > 0); // Solo mostrar estados con datos

      // 9. Últimos procesados (para la tabla)
      const ultimosProcesados = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          fechaActualizacion: Between(desde, hasta)
        },
        relations: ['documento'],
        order: { fechaActualizacion: 'DESC' },
        take: 10
      });

      const ultimosFormateados = ultimosProcesados.map(item => ({
        id: item.id,
        documento: {
          numeroRadicado: item.documento?.numeroRadicado || 'N/A',
          nombreContratista: item.documento?.nombreContratista || 'N/A'
        },
        fechaAprobacion: item.fechaAprobacion,
        fechaCreacion: item.fechaCreacion,
        estado: item.estado
      }));

      // 10. Calcular totalDocumentosRadicados (puede ser diferente si hay otra lógica)
      const totalDocumentosRadicados = await this.documentoRepository.count({
        where: { estado: 'RADICADO' }
      });

      const resultado = {
        totalDocumentosRadicados,
        enRevision,
        aprobados,
        observados,
        rechazados,
        tiempoPromedioHoras,
        eficiencia,
        distribucion,
        ultimosProcesados: ultimosFormateados,
        totales: {
          enRevision,
          aprobados,
          observados,
          rechazados,
          total: enRevision + aprobados + observados + rechazados,
        },
        fechaConsulta: new Date().toISOString(),
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
      };

      console.log('========== RESULTADO ==========');
      console.log('📊 Estadísticas calculadas:', {
        totalDocumentosRadicados,
        enRevision,
        aprobados,
        observados,
        rechazados,
        tiempoPromedioHoras,
        eficiencia,
        totales: resultado.totales,
        desde: resultado.desde,
        hasta: resultado.hasta
      });
      console.log('===============================');

      return resultado;
    } catch (error) {
      this.logger.error(`Error al calcular estadísticas para ${supervisorId}:`, error);
      throw new InternalServerErrorException('Error interno al procesar estadísticas');
    }
  }

  async verificarInconsistencias(): Promise<any> {
    try {
      const inconsistencias = await this.documentoRepository
        .createQueryBuilder('documento')
        .innerJoin('supervisor_documentos', 'supervisor', 'supervisor.documento_id = documento.id')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .andWhere('(documento.es_ultimo_radicado = :false OR documento.es_ultimo_radicado IS NULL)', { false: false })
        .select([
          'documento.id as documento_id',
          'documento.numero_radicado',
          'documento.es_ultimo_radicado',
          'supervisor.paz_salvo',
          'supervisor.estado as estado_supervision',
        ])
        .getRawMany();

      const totalDocumentos = await this.documentoRepository.count();
      const totalConPazSalvo = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .getCount();

      return {
        totalDocumentos,
        totalConPazSalvo,
        inconsistenciasEncontradas: inconsistencias.length,
        detalles: inconsistencias,
        fechaVerificacion: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando inconsistencias: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Error al verificar inconsistencias');
    }
  }
}