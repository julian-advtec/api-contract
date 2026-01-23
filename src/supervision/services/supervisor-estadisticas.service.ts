import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

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
  ) {}

  /**
   * ✅ OBTENER HISTORIAL DE REVISIONES DEL SUPERVISOR
   */
  async obtenerHistorialSupervisor(supervisorId: string): Promise<any[]> {
    const supervisorDocs = await this.supervisorRepository.find({
      where: { supervisor: { id: supervisorId } },
      relations: ['documento', 'documento.radicador'],
      order: { fechaActualizacion: 'DESC' },
      take: 50
    });

    return supervisorDocs.map(sd => ({
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
        nombreRadicador: sd.documento.nombreRadicador
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

  /**
   * ✅ OBTENER ESTADÍSTICAS DEL SUPERVISOR
   */
  async obtenerEstadisticasSupervisor(supervisorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Obteniendo estadísticas para supervisor: ${supervisorId}`);

      const totalDocumentosRadicados = await this.documentoRepository.count({
        where: { estado: 'RADICADO' }
      });

      const [enRevision, aprobados, observados, rechazados] = await Promise.all([
        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.EN_REVISION })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.APROBADO })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.OBSERVADO })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.RECHAZADO })
          .getCount()
      ]);

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();

      const aprobadosCompletos = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.APROBADO })
        .andWhere('supervisor.fechaCreacion IS NOT NULL')
        .andWhere('supervisor.fechaAprobacion IS NOT NULL')
        .select(['supervisor.fechaCreacion', 'supervisor.fechaAprobacion'])
        .getMany();

      let tiempoPromedioHoras = 0;
      if (aprobadosCompletos.length > 0) {
        const totalHoras = aprobadosCompletos.reduce((total, doc) => {
          const inicio = new Date(doc.fechaCreacion);
          const fin = new Date(doc.fechaAprobacion);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return total + horas;
        }, 0);
        tiempoPromedioHoras = Math.round(totalHoras / aprobadosCompletos.length);
      }

      const totalProcesados = aprobados + observados + rechazados;
      const eficiencia = totalProcesados > 0 ?
        Math.round((aprobados / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalDocumentosRadicados: totalDocumentosRadicados,
        enRevision: enRevision,
        aprobados: aprobados,
        observados: observados,
        rechazados: rechazados,
        recientes: recientes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        totales: {
          enRevision: enRevision,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          total: enRevision + aprobados + observados + rechazados
        },
        fechaConsulta: new Date().toISOString()
      };

      this.logger.log(`✅ Estadísticas calculadas para supervisor ${supervisorId}`);

      return estadisticas;

    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`);
      throw new InternalServerErrorException(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  /**
   * ✅ VERIFICAR INCONSISTENCIAS (diagnóstico)
   */
  async verificarInconsistencias(): Promise<any> {
    try {
      // Consultar SQL para encontrar inconsistencias
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
          'supervisor.estado as estado_supervision'
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
        fechaVerificacion: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando inconsistencias: ${error.message}`);
      throw new InternalServerErrorException('Error al verificar inconsistencias');
    }
  }
}