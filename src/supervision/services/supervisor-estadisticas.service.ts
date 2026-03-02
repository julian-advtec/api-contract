// src/supervisor/estadisticas/supervisor-estadisticas.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, IsNull } from 'typeorm';  // ← IMPORTA ESTO

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

  async obtenerEstadisticasSupervisor(supervisorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Calculando estadísticas para supervisor: ${supervisorId}`);

      const totalDocumentosRadicados = await this.documentoRepository.count({
        where: { estado: 'RADICADO' },
      });

      const [enRevision, aprobados, observados, rechazados] = await Promise.all([
        this.supervisorRepository.count({
          where: { supervisor: { id: supervisorId }, estado: SupervisorEstado.EN_REVISION },
        }),
        this.supervisorRepository.count({
          where: { supervisor: { id: supervisorId }, estado: SupervisorEstado.APROBADO },
        }),
        this.supervisorRepository.count({
          where: { supervisor: { id: supervisorId }, estado: SupervisorEstado.OBSERVADO },
        }),
        this.supervisorRepository.count({
          where: { supervisor: { id: supervisorId }, estado: SupervisorEstado.RECHAZADO },
        }),
      ]);

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.supervisorRepository.count({
        where: {
          supervisor: { id: supervisorId },
          fechaCreacion: Between(fechaLimite, new Date()),
        },
      });

      const aprobadosCompletos = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.APROBADO,
          fechaCreacion: Not(IsNull()),
          fechaAprobacion: Not(IsNull()),
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

      const totalProcesados = aprobados + observados + rechazados;
      const eficiencia = totalProcesados > 0 ? Math.round((aprobados / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalDocumentosRadicados,
        enRevision,
        aprobados,
        observados,
        rechazados,
        recientes,
        tiempoPromedioHoras,
        eficiencia,
        totales: {
          enRevision,
          aprobados,
          observados,
          rechazados,
          total: enRevision + aprobados + observados + rechazados,
        },
        fechaConsulta: new Date().toISOString(),
      };

      this.logger.log(`✅ Estadísticas calculadas: ${JSON.stringify(estadisticas)}`);
      return estadisticas;
    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Error al obtener estadísticas');
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