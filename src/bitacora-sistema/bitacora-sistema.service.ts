// src/bitacora-sistema/services/bitacora-sistema.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { BitacoraSistema, ModuloBitacora, AccionBitacora } from './entities/bitacora-sistema.entity';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { Request } from 'express';

@Injectable()
export class BitacoraSistemaService {
  private readonly logger = new Logger(BitacoraSistemaService.name);
  private readonly logsBasePath: string;

  constructor(
    @InjectRepository(BitacoraSistema)
    private bitacoraRepository: Repository<BitacoraSistema>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
  ) {
    this.logsBasePath = path.join(process.cwd(), 'logs', 'bitacora');
    this.crearEstructuraDirectorios();
  }

  /**
   * Crear estructura de directorios para logs
   */
  private crearEstructuraDirectorios(): void {
    const directorios = [
      this.logsBasePath,
      path.join(this.logsBasePath, 'documentos'),
      path.join(this.logsBasePath, 'usuarios'),
      path.join(this.logsBasePath, 'modulos'),
      path.join(this.logsBasePath, 'errores'),
    ];

    directorios.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Registrar una acción en BD y archivos TXT
   */
  async registrar(
    accion: AccionBitacora,
    modulo: ModuloBitacora,
    usuario: User | { id: string; username: string; fullName?: string; role: string },
    documento?: Documento | { id?: string; numeroRadicado?: string; rutaCarpetaRadicado?: string; numeroContrato?: string; documentoContratista?: string; nombreContratista?: string },
    metadata: any = {},
    req?: Request,
  ): Promise<BitacoraSistema | null> {
    const inicio = Date.now();

    try {
      // Obtener información del request
      const ip = this.obtenerIP(req);
      const userAgent = req?.headers['user-agent'] || 'unknown';

      // Obtener usuario completo si solo tenemos ID y no tiene role
      let usuarioCompleto: User | null = null;
      let nombreUsuario = '';
      let rolUsuario = '';

      if (usuario instanceof User) {
        usuarioCompleto = usuario;
        nombreUsuario = usuario.fullName || usuario.username;
        rolUsuario = usuario.role;
      } else if (usuario && typeof usuario === 'object') {
        if (usuario.role) {
          // Ya tiene todos los datos
          nombreUsuario = usuario.fullName || usuario.username;
          rolUsuario = usuario.role;
          usuarioCompleto = null;
        } else if (usuario.id) {
          // Buscar en BD
          const found = await this.userRepository.findOne({ where: { id: usuario.id } });
          if (found) {
            usuarioCompleto = found;
            nombreUsuario = found.fullName || found.username;
            rolUsuario = found.role;
          } else {
            nombreUsuario = usuario.username || 'Usuario desconocido';
            rolUsuario = 'unknown';
          }
        }
      }

      // Preparar metadata completa
      const metadataCompleta = {
        ...metadata,
        ip,
        userAgent,
        timestamp: new Date().toISOString(),
        duracionMs: metadata.duracionMs || 0,
      };

      // 1. GUARDAR EN BASE DE DATOS
      const bitacora = this.bitacoraRepository.create({
        accion,
        modulo,
        descripcion: this.generarDescripcion(accion, metadata),
        rolUsuario: rolUsuario || usuario.role || 'unknown',
        usuarioId: usuario.id,
        nombreUsuario: nombreUsuario || usuario.fullName || usuario.username,
        documentoId: documento?.id,
        numeroRadicado: documento?.numeroRadicado,
        numeroContrato: documento?.numeroContrato,
        documentoContratista: documento?.documentoContratista,
        nombreContratista: documento?.nombreContratista,
        metadata: metadataCompleta,
      });

      const saved = await this.bitacoraRepository.save(bitacora);

      // 2. GUARDAR EN ARCHIVOS TXT POR DOCUMENTO
      if (documento?.rutaCarpetaRadicado) {
        await this.guardarEnArchivoDocumento(
          documento.rutaCarpetaRadicado,
          { ...usuario, nombreUsuario, rolUsuario },
          accion,
          modulo,
          metadataCompleta
        );
      }

      // 3. GUARDAR EN ARCHIVO GLOBAL POR ROL
      await this.guardarEnArchivoGlobal(
        { ...usuario, nombreUsuario, rolUsuario },
        accion,
        modulo,
        documento,
        metadataCompleta
      );

      // 4. GUARDAR EN ARCHIVO POR MÓDULO
      await this.guardarEnArchivoModulo(
        modulo,
        { ...usuario, nombreUsuario, rolUsuario },
        accion,
        documento,
        metadataCompleta
      );

      const duracion = Date.now() - inicio;
      this.logger.debug(`✅ Bitácora registrada: ${modulo} - ${accion} (${duracion}ms)`);

      return saved;

    } catch (error) {
      const duracion = Date.now() - inicio;
      this.logger.error(`❌ Error registrando bitácora: ${error.message}`);
      
      // Intentar guardar en archivo de errores
      await this.guardarErrorEnArchivo(error, accion, modulo, usuario, documento, metadata);
      
      // No lanzamos error para no interrumpir el flujo principal
      return null;
    }
  }

  /**
   * Obtener IP real del request
   */
  private obtenerIP(req?: Request): string {
    if (!req) return 'unknown';
    
    let ip = req.headers['x-forwarded-for'] as string ||
             req.headers['x-real-ip'] as string ||
             req.socket?.remoteAddress ||
             'unknown';
    
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
    
    if (ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }
    
    return ip;
  }

  /**
   * Guardar en archivo TXT dentro de la carpeta del documento
   */
  private async guardarEnArchivoDocumento(
    rutaCarpeta: string,
    usuario: any,
    accion: AccionBitacora,
    modulo: ModuloBitacora,
    metadata: any
  ): Promise<void> {
    try {
      if (!rutaCarpeta) return;

      // Asegurar que la carpeta existe
      if (!fs.existsSync(rutaCarpeta)) {
        fs.mkdirSync(rutaCarpeta, { recursive: true });
      }

      const nombreArchivo = `bitacora_${modulo}.txt`;
      const rutaArchivo = path.join(rutaCarpeta, nombreArchivo);

      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const registro = this.formatearRegistroTXT(fecha, usuario, accion, modulo, metadata);

      // Leer contenido existente
      let contenidoExistente = '';
      if (fs.existsSync(rutaArchivo)) {
        contenidoExistente = fs.readFileSync(rutaArchivo, 'utf8');
      }

      // Mantener últimas 200 líneas (aumentado para mejor trazabilidad)
      const lineas = contenidoExistente.split('\n').filter(l => l.trim());
      const lineasActualizadas = [...lineas.slice(-199), registro];

      fs.writeFileSync(rutaArchivo, lineasActualizadas.join('\n'), 'utf8');

      this.logger.debug(`📝 Archivo documento: ${rutaArchivo}`);

    } catch (error) {
      this.logger.error(`Error guardando archivo documento: ${error.message}`);
    }
  }

  /**
   * Guardar en archivo global por rol
   */
  private async guardarEnArchivoGlobal(
    usuario: any,
    accion: AccionBitacora,
    modulo: ModuloBitacora,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const rol = usuario.rolUsuario || usuario.role;
      if (!rol) return;

      const logsDir = path.join(this.logsBasePath, 'roles', rol);
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      
      const nombreArchivo = `${rol}_${año}-${mes}.log`;
      const rutaArchivo = path.join(logsDir, nombreArchivo);

      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const moduloStr = `[${modulo.toUpperCase()}] `;
      const ip = metadata?.ip ? ` (IP: ${metadata.ip})` : '';
      
      const registro = `[${fecha}] ${usuario.nombreUsuario || usuario.fullName || usuario.username} (${usuario.username})${ip} - ${moduloStr}${radicado}${accion} ${metadata?.detalles ? '- ' + metadata.detalles : ''}\n`;

      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });

    } catch (error) {
      this.logger.error(`Error en archivo global: ${error.message}`);
    }
  }

  /**
   * Guardar en archivo por módulo
   */
  private async guardarEnArchivoModulo(
    modulo: ModuloBitacora,
    usuario: any,
    accion: AccionBitacora,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const logsDir = path.join(this.logsBasePath, 'modulos', modulo);
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      
      const nombreArchivo = `${modulo}_${año}-${mes}.log`;
      const rutaArchivo = path.join(logsDir, nombreArchivo);

      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const usuarioStr = `${usuario.nombreUsuario || usuario.fullName || usuario.username} (${usuario.username})`;
      const ip = metadata?.ip ? ` IP:${metadata.ip}` : '';
      
      const registro = `[${fecha}] ${usuarioStr}${ip} - ${radicado}${accion} ${metadata?.detalles || ''}\n`;

      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });

    } catch (error) {
      this.logger.error(`Error en archivo módulo: ${error.message}`);
    }
  }

  /**
   * Guardar error en archivo de errores
   */
  private async guardarErrorEnArchivo(
    error: Error,
    accion: AccionBitacora,
    modulo: ModuloBitacora,
    usuario: any,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const logsDir = path.join(this.logsBasePath, 'errores');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      
      const nombreArchivo = `errores_${año}-${mes}.log`;
      const rutaArchivo = path.join(logsDir, nombreArchivo);

      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const registro = `[${fecha}] ERROR en ${modulo}/${accion} - Usuario: ${usuario?.username || usuario?.id || 'unknown'} ${radicado}- ${error.message}\n${error.stack}\n---\n`;

      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });

    } catch (e) {
      this.logger.error(`Error guardando error: ${e.message}`);
    }
  }

  /**
   * Formatear registro para TXT
   */
  private formatearRegistroTXT(
    fecha: string,
    usuario: any,
    accion: AccionBitacora,
    modulo: ModuloBitacora,
    metadata: any
  ): string {
    const rol = usuario.rolUsuario || usuario.role || 'unknown';
    const nombre = usuario.nombreUsuario || usuario.fullName || usuario.username;
    
    let registro = `[${fecha}] ${nombre} (${usuario.username}) - ${rol.toUpperCase()} - [${modulo.toUpperCase()}] - ${accion}`;
    
    if (metadata.detalles) {
      registro += ` | ${metadata.detalles}`;
    }
    
    if (metadata.numeroArchivo) {
      registro += ` | Archivo #${metadata.numeroArchivo}`;
    }
    
    if (metadata.nombreArchivo) {
      registro += ` | ${metadata.nombreArchivo}`;
    }
    
    if (metadata.estadoAnterior && metadata.estadoNuevo) {
      registro += ` | ${metadata.estadoAnterior} → ${metadata.estadoNuevo}`;
    }
    
    if (metadata.ip && metadata.ip !== 'unknown') {
      registro += ` | IP: ${metadata.ip}`;
    }
    
    if (metadata.duracionMs) {
      registro += ` | ⏱️ ${metadata.duracionMs}ms`;
    }
    
    return registro + '\n';
  }

  /**
   * Generar descripción legible
   */
  private generarDescripcion(accion: AccionBitacora, metadata: any): string {
    const descripciones: Partial<Record<AccionBitacora, string>> = {
      [AccionBitacora.RADICAR_DOCUMENTO]: 'Documento radicado exitosamente',
      [AccionBitacora.VER_DOCUMENTO]: 'Visualización de documento',
      [AccionBitacora.DESCARGAR_ARCHIVO]: 'Descarga de archivo',
      [AccionBitacora.SUPERVISOR_APROBAR]: 'Documento aprobado por supervisor',
      [AccionBitacora.SUPERVISOR_RECHAZAR]: 'Documento rechazado por supervisor',
      [AccionBitacora.AUDITOR_APROBAR]: 'Documento aprobado por auditor',
      [AccionBitacora.CONTABILIDAD_COMPLETAR]: 'Proceso contable completado',
      [AccionBitacora.TESORERIA_APROBAR_PAGO]: 'Pago aprobado por tesorería',
      [AccionBitacora.JURIDICA_APROBAR]: 'Documento aprobado por jurídica',
      [AccionBitacora.ASESOR_APROBAR]: 'Documento aprobado por asesor de gerencia',
      [AccionBitacora.RENDICION_APROBAR]: 'Documento aprobado en rendición de cuentas',
    };

    let desc = descripciones[accion] || accion;
    
    if (metadata.detalles) {
      desc += `: ${metadata.detalles}`;
    }
    
    return desc;
  }

  // ==================== MÉTODOS DE CONSULTA ====================

  /**
   * Consultar bitácora por documento
   */
  async consultarPorDocumento(
    documentoId: string,
    options?: { limite?: number; desde?: Date; hasta?: Date; modulo?: ModuloBitacora }
  ): Promise<BitacoraSistema[]> {
    const query = this.bitacoraRepository
      .createQueryBuilder('bitacora')
      .leftJoinAndSelect('bitacora.usuario', 'usuario')
      .where('bitacora.documentoId = :documentoId', { documentoId })
      .orderBy('bitacora.fecha', 'DESC')
      .take(options?.limite || 100);

    if (options?.desde) {
      query.andWhere('bitacora.fecha >= :desde', { desde: options.desde });
    }

    if (options?.hasta) {
      query.andWhere('bitacora.fecha <= :hasta', { hasta: options.hasta });
    }

    if (options?.modulo) {
      query.andWhere('bitacora.modulo = :modulo', { modulo: options.modulo });
    }

    return query.getMany();
  }

  /**
   * Consultar bitácora por usuario
   */
  async consultarPorUsuario(
    usuarioId: string,
    limite: number = 100
  ): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { usuarioId },
      relations: ['documento'],
      order: { fecha: 'DESC' },
      take: limite,
    });
  }

  /**
   * Consultar bitácora por rol
   */
  async consultarPorRol(
    rol: string,
    limite: number = 100
  ): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { rolUsuario: rol },
      relations: ['usuario', 'documento'],
      order: { fecha: 'DESC' },
      take: limite,
    });
  }

  /**
   * Consultar bitácora por módulo
   */
  async consultarPorModulo(
    modulo: ModuloBitacora,
    limite: number = 100
  ): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { modulo },
      relations: ['usuario', 'documento'],
      order: { fecha: 'DESC' },
      take: limite,
    });
  }

  /**
   * Obtener estadísticas de bitácora
   */
  async obtenerEstadisticas(
    desde: Date,
    hasta: Date = new Date()
  ): Promise<any> {
    const stats = await this.bitacoraRepository
      .createQueryBuilder('bitacora')
      .select('bitacora.modulo', 'modulo')
      .addSelect('bitacora.accion', 'accion')
      .addSelect('COUNT(*)', 'total')
      .where('bitacora.fecha BETWEEN :desde AND :hasta', { desde, hasta })
      .groupBy('bitacora.modulo, bitacora.accion')
      .orderBy('total', 'DESC')
      .getRawMany();

    const total = await this.bitacoraRepository.count({
      where: { fecha: Between(desde, hasta) }
    });

    const porRol = await this.bitacoraRepository
      .createQueryBuilder('bitacora')
      .select('bitacora.rolUsuario', 'rol')
      .addSelect('COUNT(*)', 'total')
      .where('bitacora.fecha BETWEEN :desde AND :hasta', { desde, hasta })
      .groupBy('bitacora.rolUsuario')
      .getRawMany();

    return {
      total,
      porModulo: stats,
      porRol,
      periodo: { desde, hasta }
    };
  }

  /**
   * Obtener timeline de un documento
   */
  async obtenerTimelineDocumento(documentoId: string): Promise<any[]> {
    const registros = await this.bitacoraRepository.find({
      where: { documentoId },
      relations: ['usuario'],
      order: { fecha: 'ASC' },
    });

    return registros.map(reg => ({
      fecha: reg.fecha,
      modulo: reg.modulo,
      accion: reg.accion,
      usuario: reg.nombreUsuario,
      rol: reg.rolUsuario,
      descripcion: reg.descripcion,
      metadata: reg.metadata
    }));
  }

  /**
   * Limpiar registros antiguos (para mantenimiento)
   */
  async limpiarRegistrosAntiguos(dias: number = 90): Promise<number> {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - dias);

    const result = await this.bitacoraRepository
      .createQueryBuilder()
      .delete()
      .where('fecha < :fechaLimite', { fechaLimite })
      .execute();

    this.logger.log(`🗑️ Limpiados ${result.affected} registros antiguos (>${dias} días)`);
    return result.affected || 0;
  }
}