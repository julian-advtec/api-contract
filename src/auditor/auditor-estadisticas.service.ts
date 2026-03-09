// src/auditor/services/auditor-estadisticas.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';

import { AuditorDocumento } from './entities/auditor-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AuditorEstado } from './entities/auditor-documento.entity';

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
  ) { }

  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
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
      observacion: ad.observaciones,
      correcciones: ad.correcciones || '',
      fechaCreacion: ad.fechaCreacion,
      fechaActualizacion: ad.fechaActualizacion,
      fechaAprobacion: ad.fechaAprobacion,
      fechaInicioRevision: ad.fechaInicioRevision,
      fechaFinRevision: ad.fechaFinRevision,
      archivos: {
        rp: !!ad.rpPath,
        cdp: !!ad.cdpPath,
        poliza: !!ad.polizaPath,
        certificadoBancario: !!ad.certificadoBancarioPath,
        minuta: !!ad.minutaPath,
        actaInicio: !!ad.actaInicioPath,
      }
    }));
  }

  async obtenerEstadisticasAuditor(
    auditorId: string,
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
      this.logger.log(`📊 Calculando estadísticas para auditor ${auditorId} desde ${desdeLocal.toISOString()} hasta ${hastaLocal.toISOString()}`);

      // Obtener TODOS los documentos del auditor (sin filtro de estado)
      const todosMisDocumentos = await this.auditorRepository.find({
        where: { auditor: { id: auditorId } },
        relations: ['documento'],
      });

      this.logger.log(`📊 Total documentos del auditor: ${todosMisDocumentos.length}`);

      // Filtrar por fecha
      const documentosEnPeriodo = todosMisDocumentos.filter(doc => {
        const fecha = doc.fechaAprobacion || doc.fechaActualizacion || doc.fechaCreacion;
        return fecha >= desdeLocal && fecha <= hastaLocal;
      });

      // Contar por estado
      const enRevision = documentosEnPeriodo.filter(d => d.estado === AuditorEstado.EN_REVISION).length;
      const aprobados = documentosEnPeriodo.filter(d => d.estado === AuditorEstado.APROBADO).length;
      const observados = documentosEnPeriodo.filter(d => d.estado === AuditorEstado.OBSERVADO).length;
      const rechazadosAuditor = documentosEnPeriodo.filter(d => d.estado === AuditorEstado.RECHAZADO).length;
      const completados = documentosEnPeriodo.filter(d => d.estado === AuditorEstado.COMPLETADO).length;

      // Primer radicados
      const primerRadicados = documentosEnPeriodo.filter(d => d.documento?.primerRadicadoDelAno).length;

      // Calcular tiempo promedio
      let tiempoPromedioHoras = 0;
      const revisionesCompletadas = documentosEnPeriodo.filter(d =>
        d.fechaInicioRevision && d.fechaFinRevision
      );

      if (revisionesCompletadas.length > 0) {
        const sumaHoras = revisionesCompletadas.reduce((acc, doc) => {
          const inicio = new Date(doc.fechaInicioRevision);
          const fin = new Date(doc.fechaFinRevision);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return acc + (horas > 0 ? horas : 0);
        }, 0);
        tiempoPromedioHoras = Math.round((sumaHoras / revisionesCompletadas.length) * 10) / 10;
      }

      // Recientes (últimos 7 días)
      const fechaLimiteRecientes = new Date(ahoraLocal.getTime() - 7 * 24 * 60 * 60 * 1000);
      const recientes = todosMisDocumentos.filter(d =>
        new Date(d.fechaCreacion) >= fechaLimiteRecientes
      ).length;

      // Calcular rechazados globales (todos los documentos)
      const estadosRechazo = [
        'RECHAZADO', 'RECHAZADO_AUDITOR', 'RECHAZADO_SUPERVISOR',
        'RECHAZADO_TESORERIA', 'RECHAZADO_ASESOR_GERENCIA',
        'RECHAZADO_RENDICION_CUENTAS', 'OBSERVADO', 'OBSERVADO_AUDITOR'
      ];

      const rechazadosTotales = await this.documentoRepository
        .createQueryBuilder('documento')
        .where('documento.fechaActualizacion BETWEEN :desde AND :hasta', {
          desde: desdeLocal,
          hasta: hastaLocal,
        })
        .andWhere('documento.estado IN (:...estadosRechazo)', { estadosRechazo })
        .getCount();

      // Totales y eficiencia
      const totalMisDocumentos = documentosEnPeriodo.length;
      const totalProcesados = aprobados + observados + rechazadosAuditor + completados;
      const eficiencia = totalProcesados > 0
        ? Math.round(((aprobados + completados) / totalProcesados) * 100)
        : 0;

      // Distribución - CORREGIDO: Definir el tipo correctamente
      interface DistribucionItem {
        estado: string;
        cantidad: number;
        color: string;
        porcentaje?: number;
      }

      const distribucion: DistribucionItem[] = [
        { estado: 'Aprobados', cantidad: aprobados, color: '#4CAF50' },
        { estado: 'Observados', cantidad: observados, color: '#FF9800' },
        { estado: 'Rechazados', cantidad: rechazadosAuditor, color: '#F44336' },
        { estado: 'En Revisión', cantidad: enRevision, color: '#2196F3' },
        { estado: 'Completados', cantidad: completados, color: '#9C27B0' },
      ].filter(item => item.cantidad > 0);

      // Calcular porcentajes para distribución
      distribucion.forEach(item => {
        item.porcentaje = totalMisDocumentos > 0
          ? Math.round((item.cantidad / totalMisDocumentos) * 100)
          : 0;
      });

      // Últimos 10 procesados
      const ultimosProcesados = documentosEnPeriodo
        .sort((a, b) => {
          const fechaA = a.fechaActualizacion || a.fechaCreacion;
          const fechaB = b.fechaActualizacion || b.fechaCreacion;
          return fechaB.getTime() - fechaA.getTime();
        })
        .slice(0, 10)
        .map(item => ({
          id: item.id,
          numeroRadicado: item.documento?.numeroRadicado || 'N/A',
          contratista: item.documento?.nombreContratista || 'N/A',
          fecha: item.fechaAprobacion || item.fechaActualizacion || item.fechaCreacion,
          estado: item.estado,
          primerRadicado: item.documento?.primerRadicadoDelAno || false,
        }));

      // Total documentos (todos, no solo disponibles)
      const totalDocumentos = await this.documentoRepository.count();

      // Resultado final
      const resultado = {
        totalDocumentosDisponibles: totalDocumentos,
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
        totales: {
          enRevision,
          aprobados,
          observados,
          rechazados: rechazadosAuditor,
          completados,
          total: totalMisDocumentos,
        },
        fechaConsulta: new Date().toISOString(),
        desde: desdeLocal.toISOString(),
        hasta: hastaLocal.toISOString(),
      };

      this.logger.log(`✅ Estadísticas generadas: ${totalMisDocumentos} documentos en período, eficiencia: ${eficiencia}%`);
      return resultado;

    } catch (error) {
      this.logger.error('[Auditor Estadísticas] Error al calcular:', error);
      throw new InternalServerErrorException('Error al obtener estadísticas de auditoría');
    }
  }
  
  
  async obtenerDocumentosRechazados(
    auditorId: string,
    filtros?: {
      soloMios?: boolean;
      desde?: Date;
      hasta?: Date;
    }
  ): Promise<any[]> {
    try {
      this.logger.log(`📋 Obteniendo documentos rechazados para auditor ${auditorId}`);

      // Usar SOLO los valores del enum que existen en la BD
      const estadosRechazo = [
        AuditorEstado.RECHAZADO,  // ← Este es el valor correcto
        AuditorEstado.OBSERVADO,  // ← Este es el valor correcto
      ];

      const query = this.auditorRepository
        .createQueryBuilder('ad')
        .leftJoinAndSelect('ad.documento', 'documento')
        .leftJoinAndSelect('ad.auditor', 'auditor')
        .where('ad.estado IN (:...estados)', {
          estados: estadosRechazo
        });

      if (filtros?.soloMios) {
        query.andWhere('auditor.id = :auditorId', { auditorId });
      }

      if (filtros?.desde && filtros?.hasta) {
        query.andWhere('ad.fechaAprobacion BETWEEN :desde AND :hasta', {
          desde: filtros.desde,
          hasta: filtros.hasta,
        });
      }

      const resultados = await query
        .orderBy('ad.fechaAprobacion', 'DESC')
        .getMany();

      this.logger.log(`✅ Encontrados ${resultados.length} documentos rechazados/observados`);

      return resultados.map(ad => ({
        id: ad.id,
        documento: {
          id: ad.documento.id,
          numeroRadicado: ad.documento.numeroRadicado,
          nombreContratista: ad.documento.nombreContratista,
          documentoContratista: ad.documento.documentoContratista,
          numeroContrato: ad.documento.numeroContrato,
          fechaRadicacion: ad.documento.fechaRadicacion,
          fechaInicio: ad.documento.fechaInicio,
          fechaFin: ad.documento.fechaFin,
          estado: ad.documento.estado,
          cuentaCobro: ad.documento.cuentaCobro,
          seguridadSocial: ad.documento.seguridadSocial,
          informeActividades: ad.documento.informeActividades,
          comentarios: ad.documento.comentarios,
          primerRadicadoDelAno: ad.documento.primerRadicadoDelAno,
        },
        auditorRevisor: ad.auditor?.fullName || ad.auditor?.username,
        estado: ad.estado,
        observaciones: ad.observaciones,
        correcciones: ad.correcciones || '',
        fechaCreacion: ad.fechaCreacion,
        fechaActualizacion: ad.fechaActualizacion,
        fechaRechazo: ad.fechaAprobacion || ad.fechaActualizacion,
        archivos: {
          rp: !!ad.rpPath,
          cdp: !!ad.cdpPath,
          poliza: !!ad.polizaPath,
          certificadoBancario: !!ad.certificadoBancarioPath,
          minuta: !!ad.minutaPath,
          actaInicio: !!ad.actaInicioPath,
        }
      }));
    } catch (error) {
      this.logger.error(`Error obteniendo documentos rechazados: ${error.message}`);
      return [];
    }
  }

  async verificarInconsistencias(): Promise<any> {
    try {
      const inconsistencias = await this.documentoRepository
        .createQueryBuilder('documento')
        .innerJoin('auditor_documentos', 'auditor', 'auditor.documento_id = documento.id')
        .where('auditor.observaciones IS NOT NULL')
        .andWhere('auditor.observaciones != :empty', { empty: '' })
        .andWhere('(documento.es_ultimo_radicado = :false OR documento.es_ultimo_radicado IS NULL)', { false: false })
        .select([
          'documento.id as documento_id',
          'documento.numero_radicado',
          'documento.es_ultimo_radicado',
          'auditor.observaciones',
          'auditor.estado as estado_auditor',
        ])
        .getRawMany();

      const totalDocumentos = await this.documentoRepository.count();
      const totalConObservaciones = await this.auditorRepository
        .createQueryBuilder('auditor')
        .where('auditor.observaciones IS NOT NULL')
        .andWhere('auditor.observaciones != :empty', { empty: '' })
        .getCount();

      return {
        totalDocumentos,
        totalConObservaciones,
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