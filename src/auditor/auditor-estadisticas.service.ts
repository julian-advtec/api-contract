// src/auditor/services/auditor-estadisticas.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Not } from 'typeorm';

import { AuditorDocumento, AuditorEstado } from '../entities/auditor-documento.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { EstadisticasAuditor, PeriodoStats, DocumentoAuditorResumen } from '../models/auditor-estadisticas.model';

@Injectable()
export class AuditorEstadisticasService {
  private readonly logger = new Logger(AuditorEstadisticasService.name);

  constructor(
    @InjectRepository(AuditorDocumento)
    private auditorRepository: Repository<AuditorDocumento>,

    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Obteniendo historial para auditor: ${auditorId}`);

    const auditorDocs = await this.auditorRepository.find({
      where: { auditor: { id: auditorId } },
      relations: ['documento', 'documento.radicador'],
      order: { fechaActualizacion: 'DESC' },
      take: 50,
    });

    this.logger.debug(`Historial encontrado: ${auditorDocs.length} registros`);

    return auditorDocs.map((ad) => ({
      id: ad.id,
      documento: {
        id: ad.documento.id,
        numeroRadicado: ad.documento.numeroRadicado,
        nombreContratista: ad.documento.nombreContratista,
        documentoContratista: ad.documento.documentoContratista,
        numeroContrato: ad.documento.numeroContrato,
        fechaInicio: ad.documento.fechaInicio,
        fechaFin: ad.documento.fechaFin,
        fechaRadicacion: ad.documento.fechaRadicacion,
        estado: ad.documento.estado,
        cuentaCobro: ad.documento.cuentaCobro,
        seguridadSocial: ad.documento.seguridadSocial,
        informeActividades: ad.documento.informeActividades,
        observacion: ad.documento.observacion,
        nombreRadicador: ad.documento.nombreRadicador,
        primerRadicadoDelAno: ad.documento.primerRadicadoDelAno,
      },
      auditorRevisor: ad.auditor?.fullName || ad.auditor?.username,
      estado: ad.estado,
      observaciones: ad.observaciones,
      correcciones: ad.correcciones || '',
      fechaCreacion: ad.fechaCreacion,
      fechaActualizacion: ad.fechaActualizacion,
      fechaAprobacion: ad.fechaAprobacion,
      fechaInicioRevision: ad.fechaInicioRevision,
      fechaFinRevision: ad.fechaFinRevision,
      tieneArchivos: ad.tieneTodosDocumentos(),
      archivos: {
        rp: !!ad.rpPath,
        cdp: !!ad.cdpPath,
        poliza: !!ad.polizaPath,
        certificadoBancario: !!ad.certificadoBancarioPath,
        minuta: !!ad.minutaPath,
        actaInicio: !!ad.actaInicioPath,
      },
    }));
  }

  async obtenerEstadisticasAuditor(
    auditorId: string,
    periodo: string = 'ano'
  ): Promise<EstadisticasAuditor> {
    const ahoraLocal = new Date();
    ahoraLocal.setMilliseconds(0);

    let desdeLocal = new Date(ahoraLocal);
    const periodoLower = periodo.trim().toLowerCase();

    // Configurar fechas según período
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
      this.logger.log(`📊 Calculando estadísticas para auditor ${auditorId} desde ${desdeLocal.toISOString()} hasta ${hastaLocal.toISOString()}`);

      // ────────────────────────────────────────────────────────────────
      // 1. Documentos disponibles (APROBADO_SUPERVISOR)
      // ────────────────────────────────────────────────────────────────
      const totalDocumentosDisponibles = await this.documentoRepository.count({
        where: { estado: 'APROBADO_SUPERVISOR' }
      });

      // ────────────────────────────────────────────────────────────────
      // 2. Mis documentos por estado (específicos del auditor)
      // ────────────────────────────────────────────────────────────────
      const [
        enRevision,
        aprobados,
        observados,
        rechazadosAuditor,
        completados,
        primerRadicados,
        recientes
      ] = await Promise.all([
        // En revisión actualmente
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.EN_REVISION,
            fechaInicioRevision: Between(desdeLocal, hastaLocal),
          },
        }),

        // Aprobados por este auditor
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.APROBADO,
            fechaAprobacion: Between(desdeLocal, hastaLocal),
          },
        }),

        // Observados por este auditor
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.OBSERVADO,
            fechaAprobacion: Between(desdeLocal, hastaLocal),
          },
        }),

        // Rechazados por este auditor
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.RECHAZADO,
            fechaAprobacion: Between(desdeLocal, hastaLocal),
          },
        }),

        // Completados por este auditor
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.COMPLETADO,
            fechaAprobacion: Between(desdeLocal, hastaLocal),
          },
        }),

        // Primer radicados revisados
        this.auditorRepository
          .createQueryBuilder('ad')
          .leftJoin('ad.documento', 'documento')
          .where('ad.auditor_id = :auditorId', { auditorId })
          .andWhere('documento.primerRadicadoDelAno = :primer', { primer: true })
          .andWhere('ad.fechaAprobacion BETWEEN :desde AND :hasta', {
            desde: desdeLocal,
            hasta: hastaLocal,
          })
          .getCount(),

        // Documentos recientes (últimos 7 días)
        this.auditorRepository
          .createQueryBuilder('ad')
          .where('ad.auditor_id = :auditorId', { auditorId })
          .andWhere('ad.fechaCreacion >= :fechaLimite', {
            fechaLimite: new Date(ahoraLocal.getTime() - 7 * 24 * 60 * 60 * 1000)
          })
          .getCount(),
      ]);

      // ────────────────────────────────────────────────────────────────
      // 3. RECHAZADOS GLOBALES (todas las áreas)
      // ────────────────────────────────────────────────────────────────
      const estadosRechazo = [
        // Auditor
        'RECHAZADO_AUDITOR',
        'OBSERVADO_AUDITOR',
        
        // Supervisor
        'RECHAZADO_SUPERVISOR',
        'DEVUELTO_SUPERVISOR',
        
        // Tesorería
        'RECHAZADO_TESORERIA',
        'OBSERVADO_TESORERIA',
        
        // Asesor Gerencia
        'RECHAZADO_ASESOR_GERENCIA',
        'OBSERVADO_ASESOR_GERENCIA',
        
        // Rendición de Cuentas
        'RECHAZADO_RENDICION_CUENTAS',
        'OBSERVADO_RENDICION_CUENTAS',
        
        // Contabilidad
        'RECHAZADO_CONTABILIDAD',
        'OBSERVADO_CONTABILIDAD',
        'GLOSADO',
      ];

      const rechazadosTotales = await this.documentoRepository
        .createQueryBuilder('documento')
        .where('documento.fechaActualizacion BETWEEN :desde AND :hasta', {
          desde: desdeLocal,
          hasta: hastaLocal,
        })
        .andWhere('documento.estado IN (:...estadosRechazo)', {
          estadosRechazo,
        })
        .getCount();

      // ────────────────────────────────────────────────────────────────
      // 4. Tiempo promedio de revisión
      // ────────────────────────────────────────────────────────────────
      const revisionesConTiempo = await this.auditorRepository
        .createQueryBuilder('ad')
        .where('ad.auditor_id = :auditorId', { auditorId })
        .andWhere('ad.estado IN (:...estados)', {
          estados: [AuditorEstado.APROBADO, AuditorEstado.COMPLETADO]
        })
        .andWhere('ad.fechaInicioRevision IS NOT NULL')
        .andWhere('ad.fechaFinRevision IS NOT NULL')
        .andWhere('ad.fechaAprobacion BETWEEN :desde AND :hasta', {
          desde: desdeLocal,
          hasta: hastaLocal,
        })
        .select(['ad.fechaInicioRevision', 'ad.fechaFinRevision'])
        .getMany();

      let tiempoPromedioHoras = 0;
      if (revisionesConTiempo.length > 0) {
        const sumaHoras = revisionesConTiempo.reduce((acc, doc) => {
          const inicio = new Date(doc.fechaInicioRevision);
          const fin = new Date(doc.fechaFinRevision);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return acc + (horas > 0 ? horas : 0);
        }, 0);
        tiempoPromedioHoras = Math.round((sumaHoras / revisionesConTiempo.length) * 10) / 10;
      }

      // ────────────────────────────────────────────────────────────────
      // 5. Totales y eficiencia
      // ────────────────────────────────────────────────────────────────
      const totalMisDocumentos = enRevision + aprobados + observados + rechazadosAuditor + completados;
      const totalProcesados = aprobados + observados + rechazadosAuditor + completados;

      const eficiencia = totalProcesados > 0
        ? Math.round(((aprobados + completados) / totalProcesados) * 100)
        : 0;

      // ────────────────────────────────────────────────────────────────
      // 6. Distribución para gráficos
      // ────────────────────────────────────────────────────────────────
      const distribucion = [
        {
          estado: 'En Revisión',
          cantidad: enRevision,
          porcentaje: totalMisDocumentos > 0 ? Math.round((enRevision / totalMisDocumentos) * 100) : 0,
          color: '#FFB74D',
        },
        {
          estado: 'Aprobados',
          cantidad: aprobados,
          porcentaje: totalMisDocumentos > 0 ? Math.round((aprobados / totalMisDocumentos) * 100) : 0,
          color: '#4CAF50',
        },
        {
          estado: 'Observados',
          cantidad: observados,
          porcentaje: totalMisDocumentos > 0 ? Math.round((observados / totalMisDocumentos) * 100) : 0,
          color: '#FF9800',
        },
        {
          estado: 'Rechazados',
          cantidad: rechazadosAuditor,
          porcentaje: totalMisDocumentos > 0 ? Math.round((rechazadosAuditor / totalMisDocumentos) * 100) : 0,
          color: '#F44336',
        },
        {
          estado: 'Completados',
          cantidad: completados,
          porcentaje: totalMisDocumentos > 0 ? Math.round((completados / totalMisDocumentos) * 100) : 0,
          color: '#2196F3',
        },
      ].filter(item => item.cantidad > 0);

      // ────────────────────────────────────────────────────────────────
      // 7. Últimos procesados
      // ────────────────────────────────────────────────────────────────
      const ultimosProcesadosRaw = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          fechaActualizacion: Between(desdeLocal, hastaLocal),
        },
        relations: ['documento'],
        order: { fechaActualizacion: 'DESC' },
        take: 10,
      });

      const ultimosProcesados: DocumentoAuditorResumen[] = ultimosProcesadosRaw.map(item => ({
        id: item.documento.id,
        numeroRadicado: item.documento?.numeroRadicado || 'N/A',
        nombreContratista: item.documento?.nombreContratista || 'N/A',
        documentoContratista: item.documento?.documentoContratista || 'N/A',
        numeroContrato: item.documento?.numeroContrato || 'N/A',
        fechaRadicacion: item.documento?.fechaRadicacion,
        fechaRevision: item.fechaAprobacion || item.fechaActualizacion || item.fechaCreacion,
        estado: item.documento?.estado || 'N/A',
        estadoAuditor: item.estado,
        observaciones: item.observaciones,
        primerRadicadoDelAno: item.documento?.primerRadicadoDelAno || false,
      }));

      // ────────────────────────────────────────────────────────────────
      // 8. Resultado final
      // ────────────────────────────────────────────────────────────────
      const resultado: EstadisticasAuditor = {
        totalDocumentosDisponibles,
        misDocumentos: {
          enRevision,
          aprobados,
          observados,
          rechazados: rechazadosAuditor,
          completados,
          primerRadicados,
          total: totalMisDocumentos,
        },
        rechazados: {
          total: rechazadosTotales,
          rechazadosAuditor,
          rechazadosOtrasAreas: rechazadosTotales - rechazadosAuditor,
          porPeriodo: rechazadosAuditor,
        },
        tiempoPromedioHoras,
        eficiencia,
        recientes,
        distribucion,
        ultimosProcesados,
        fechaConsulta: new Date().toISOString(),
        desde: desdeLocal.toISOString(),
        hasta: hastaLocal.toISOString(),
        diagnostico: {
          periodoSolicitado: periodoLower,
          fechaDesde: desdeLocal.toISOString(),
          fechaHasta: hastaLocal.toISOString(),
        },
      };

      this.logger.log(`✅ Estadísticas generadas para auditor ${auditorId}: Total procesados: ${totalProcesados}, Eficiencia: ${eficiencia}%`);

      return resultado;
    } catch (error) {
      this.logger.error('[Auditor Estadísticas] Error al calcular:', error);
      throw new InternalServerErrorException('Error al obtener estadísticas de auditoría');
    }
  }

  async obtenerDocumentosRechazados(
    auditorId: string,
    filtros?: {
      desde?: Date;
      hasta?: Date;
      soloMios?: boolean;
    }
  ): Promise<any[]> {
    try {
      this.logger.log(`📋 Auditor ${auditorId} solicitando documentos rechazados`);

      const query = this.auditorRepository
        .createQueryBuilder('ad')
        .leftJoinAndSelect('ad.documento', 'documento')
        .leftJoinAndSelect('ad.auditor', 'auditor')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .where('ad.estado IN (:...estados)', {
          estados: [AuditorEstado.RECHAZADO, AuditorEstado.OBSERVADO]
        });

      // Filtrar por fechas si se proporcionan
      if (filtros?.desde && filtros?.hasta) {
        query.andWhere('ad.fechaAprobacion BETWEEN :desde AND :hasta', {
          desde: filtros.desde,
          hasta: filtros.hasta,
        });
      }

      // Filtrar solo los rechazados por este auditor
      if (filtros?.soloMios) {
        query.andWhere('auditor.id = :auditorId', { auditorId });
      }

      const rechazados = await query
        .orderBy('ad.fechaAprobacion', 'DESC')
        .getMany();

      this.logger.log(`✅ Encontrados ${rechazados.length} documentos rechazados`);

      return rechazados.map(ad => ({
        id: ad.documento.id,
        documento: {
          id: ad.documento.id,
          numeroRadicado: ad.documento.numeroRadicado,
          numeroContrato: ad.documento.numeroContrato,
          nombreContratista: ad.documento.nombreContratista,
          documentoContratista: ad.documento.documentoContratista,
          fechaRadicacion: ad.documento.fechaRadicacion,
          fechaInicio: ad.documento.fechaInicio,
          fechaFin: ad.documento.fechaFin,
          estado: ad.documento.estado,
          cuentaCobro: ad.documento.cuentaCobro,
          seguridadSocial: ad.documento.seguridadSocial,
          informeActividades: ad.documento.informeActividades,
        },
        auditorRevisor: ad.auditor?.fullName || ad.auditor?.username,
        estado: ad.estado,
        observaciones: ad.observaciones,
        correcciones: ad.correcciones || '',
        fechaCreacion: ad.fechaCreacion,
        fechaActualizacion: ad.fechaActualizacion,
        fechaRechazo: ad.fechaAprobacion || ad.fechaActualizacion,
        tieneArchivos: ad.tieneTodosDocumentos(),
        archivos: {
          rp: !!ad.rpPath,
          cdp: !!ad.cdpPath,
          poliza: !!ad.polizaPath,
          certificadoBancario: !!ad.certificadoBancarioPath,
          minuta: !!ad.minutaPath,
          actaInicio: !!ad.actaInicioPath,
        },
      }));
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos rechazados: ${error.message}`);
      throw error;
    }
  }
}