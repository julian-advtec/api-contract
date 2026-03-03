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
  periodo: string = 'ano'
): Promise<any> {
  const ahoraLocal = new Date();
  ahoraLocal.setMilliseconds(0);

  let desdeLocal = new Date(ahoraLocal);

  const periodoLower = periodo.trim().toLowerCase();

  switch (periodoLower) {
    case 'hoy':
      desdeLocal.setHours(0, 0, 0, 0);
      break;

    case 'semana':
      desdeLocal.setDate(ahoraLocal.getDate() - 7);
      desdeLocal.setHours(0, 0, 0, 0);
      break;

    case 'mes':
      desdeLocal.setMonth(ahoraLocal.getMonth() - 1);
      desdeLocal.setHours(0, 0, 0, 0);
      break;

    case 'trimestre':
      desdeLocal.setMonth(ahoraLocal.getMonth() - 3);
      desdeLocal.setHours(0, 0, 0, 0);
      break;

    case 'ano':
    default:
      desdeLocal = new Date(ahoraLocal.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
  }

  const hastaLocal = new Date(ahoraLocal);

  try {
    const [aprobados, observados, rechazados, enRevision] = await Promise.all([
      this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.APROBADO,
          fechaAprobacion: Between(desdeLocal, hastaLocal),
        },
      }),

      this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.OBSERVADO,
          fechaAprobacion: Between(desdeLocal, hastaLocal),
        },
      }),

      this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.RECHAZADO,
          fechaAprobacion: Between(desdeLocal, hastaLocal),
        },
      }),

      this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION,
          fechaCreacion: Between(desdeLocal, hastaLocal),
        },
      }),
    ]);

    const totalProcesados = aprobados + observados + rechazados;
    const eficiencia = totalProcesados > 0 ? Math.round((aprobados / totalProcesados) * 100) : 0;

    const aprobadosConFechas = await this.supervisorRepository.find({
      where: {
        supervisor: { id: supervisorId },
        estado: SupervisorEstado.APROBADO,
        fechaAprobacion: Between(desdeLocal, hastaLocal),
      },
      select: ['fechaCreacion', 'fechaAprobacion'],
    });

    let tiempoPromedioHoras = 0;
    if (aprobadosConFechas.length > 0) {
      const sumaHoras = aprobadosConFechas.reduce((acc, doc) => {
        if (doc.fechaCreacion && doc.fechaAprobacion) {
          const diffMs = doc.fechaAprobacion.getTime() - doc.fechaCreacion.getTime();
          const horas = diffMs / (1000 * 60 * 60);
          return acc + (horas > 0 ? horas : 0);
        }
        return acc;
      }, 0);
      tiempoPromedioHoras = Math.round((sumaHoras / aprobadosConFechas.length) * 10) / 10;
    }

    const distribucion = [
      { estado: 'Aprobados',   cantidad: aprobados,   porcentaje: totalProcesados ? Math.round((aprobados   / totalProcesados) * 100) : 0, color: '#4CAF50' },
      { estado: 'Observados',  cantidad: observados,  porcentaje: totalProcesados ? Math.round((observados  / totalProcesados) * 100) : 0, color: '#FF9800' },
      { estado: 'Rechazados',  cantidad: rechazados,  porcentaje: totalProcesados ? Math.round((rechazados  / totalProcesados) * 100) : 0, color: '#F44336' },
      { estado: 'En Revisión', cantidad: enRevision,  porcentaje: totalProcesados ? Math.round((enRevision  / totalProcesados) * 100) : 0, color: '#2196F3' },
    ].filter(item => item.cantidad > 0);

    const ultimosProcesadosRaw = await this.supervisorRepository.find({
      where: {
        supervisor: { id: supervisorId },
        fechaActualizacion: Between(desdeLocal, hastaLocal),
      },
      relations: ['documento'],
      order: { fechaActualizacion: 'DESC' },
      take: 10,
    });

    const ultimosProcesados = ultimosProcesadosRaw.map(item => ({
      id: item.id,
      numeroRadicado: item.documento?.numeroRadicado || 'N/A',
      contratista: item.documento?.nombreContratista || 'N/A',
      fecha: item.fechaAprobacion || item.fechaActualizacion || item.fechaCreacion,
      estado: item.estado,
    }));

    const totalDocumentosRadicados = await this.documentoRepository.count();

    const resultado = {
      totalDocumentosRadicados,
      enRevision,
      aprobados,
      observados,
      rechazados,
      tiempoPromedioHoras,
      eficiencia,
      distribucion,
      ultimosProcesados,
      totales: {
        enRevision,
        aprobados,
        observados,
        rechazados,
        total: totalProcesados,
      },
      fechaConsulta: new Date().toISOString(),
      desde: desdeLocal.toISOString(),
      hasta: hastaLocal.toISOString(),
    };

    return resultado;
  } catch (error) {
    this.logger.error('[Supervisor Estadísticas] Error al calcular:', error);
    throw new InternalServerErrorException('Error al obtener estadísticas de supervisión');
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