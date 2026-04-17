// src/bitacora-sistema/services/bitacora-sistema.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { BitacoraSistema, ModuloBitacora, AccionBitacora } from './entities/bitacora-sistema.entity';
import { Request } from 'express';

@Injectable()
export class BitacoraSistemaService {
  private readonly logger = new Logger(BitacoraSistemaService.name);
  // ✅ SOLO RUTA UNC - NADA DE Z:\
  private readonly LOGS_BASE_PATH = '\\\\R2-D2\\api-contract\\logs\\bitacora';

  constructor(
    @InjectRepository(BitacoraSistema)
    private bitacoraRepository: Repository<BitacoraSistema>,
  ) {
    this.logger.log(`📁 Ruta de logs configurada: ${this.LOGS_BASE_PATH}`);
    this.crearEstructuraDirectorios();
  }

  private crearEstructuraDirectorios(): void {
    const directorios = [
      this.LOGS_BASE_PATH,
      `${this.LOGS_BASE_PATH}\\documentos`,
      `${this.LOGS_BASE_PATH}\\usuarios`,
      `${this.LOGS_BASE_PATH}\\modulos`,
      `${this.LOGS_BASE_PATH}\\errores`,
      `${this.LOGS_BASE_PATH}\\general`,
      `${this.LOGS_BASE_PATH}\\roles`,
    ];

    directorios.forEach(dir => {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          this.logger.log(`📁 Directorio creado: ${dir}`);
        }
      } catch (error: any) {
        this.logger.error(`❌ ERROR: No se pudo crear directorio en ${dir}`);
        this.logger.error(`   ${error.message}`);
        throw new Error(`No se puede acceder al servidor R2-D2: ${error.message}`);
      }
    });
  }

  async registrar(
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    usuario: any,
    documento?: any,
    metadata: any = {},
    req?: Request,
  ): Promise<BitacoraSistema | null> {
    const inicio = Date.now();

    try {
      const ip = this.obtenerIP(req);
      const userAgent = req?.headers['user-agent'] || 'unknown';

      let nombreUsuario = '';
      let rolUsuario = '';

      if (usuario) {
        nombreUsuario = usuario.fullName || usuario.username || 'Usuario';
        rolUsuario = usuario.role || 'unknown';
      }

      const metadataCompleta = {
        ...metadata,
        ip,
        userAgent,
        timestamp: new Date().toISOString(),
        duracionMs: metadata.duracionMs || 0,
      };

      // GUARDAR EN BASE DE DATOS
      const bitacora = this.bitacoraRepository.create({
        accion: typeof accion === 'string' ? accion : String(accion),
        modulo: typeof modulo === 'string' ? modulo : String(modulo),
        descripcion: this.generarDescripcion(accion, metadata),
        rol_usuario: rolUsuario,
        usuario_id: usuario?.id,
        nombre_usuario: nombreUsuario,
        documento_id: documento?.id,
        numero_radicado: documento?.numeroRadicado,
        numero_contrato: documento?.numeroContrato,
        documento_contratista: documento?.documentoContratista,
        nombre_contratista: documento?.nombreContratista,
        metadata: metadataCompleta,
      });

      const saved = await this.bitacoraRepository.save(bitacora);
      this.logger.log(`✅ Bitácora guardada en BD: ${modulo} - ${accion} - Usuario: ${nombreUsuario}`);

      // GUARDAR EN ARCHIVOS TXT EN EL SERVIDOR (SOLO RED)
      if (documento?.rutaCarpetaRadicado) {
        await this.guardarEnArchivoDocumento(
          documento.rutaCarpetaRadicado,
          { ...usuario, nombre_usuario: nombreUsuario, rol_usuario: rolUsuario },
          accion,
          modulo,
          metadataCompleta
        );
      }

      await this.guardarEnArchivoGlobal(
        { ...usuario, nombre_usuario: nombreUsuario, rol_usuario: rolUsuario },
        accion,
        modulo,
        documento,
        metadataCompleta
      );

      await this.guardarEnArchivoModulo(
        modulo,
        { ...usuario, nombre_usuario: nombreUsuario, rol_usuario: rolUsuario },
        accion,
        documento,
        metadataCompleta
      );

      await this.guardarEnArchivoGeneral(
        { ...usuario, nombre_usuario: nombreUsuario, rol_usuario: rolUsuario },
        accion,
        modulo,
        documento,
        metadataCompleta
      );

      this.logger.debug(`✅ Bitácora completada: ${modulo} - ${accion} (${Date.now() - inicio}ms)`);
      return saved;

    } catch (error: any) {
      this.logger.error(`❌ Error registrando bitácora: ${error.message}`);
      await this.guardarErrorEnArchivo(error, accion, modulo, usuario, documento, metadata);
      return null;
    }
  }

  private obtenerIP(req?: Request): string {
    if (!req) return 'unknown';
    let ip = req.headers['x-forwarded-for'] as string ||
             req.headers['x-real-ip'] as string ||
             req.socket?.remoteAddress ||
             'unknown';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    return ip;
  }

  private async guardarEnArchivoDocumento(
    rutaCarpeta: string,
    usuario: any,
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    metadata: any
  ): Promise<void> {
    try {
      let carpeta = rutaCarpeta;
      
      // ✅ SOLO UNC - Sin ninguna referencia a Z:\
      // Si la ruta no empieza con \\, asumimos que es relativa a la base
      if (!carpeta.startsWith('\\\\')) {
        // Eliminar cualquier prefijo incorrecto
        let cleanPath = carpeta;
        if (cleanPath.startsWith('Z:')) {
          cleanPath = cleanPath.substring(2);
        }
        if (cleanPath.startsWith('\\')) {
          cleanPath = cleanPath.substring(1);
        }
        carpeta = `\\\\R2-D2\\api-contract\\${cleanPath}`;
      }
      
      if (!fs.existsSync(carpeta)) {
        fs.mkdirSync(carpeta, { recursive: true });
      }

      const nombreArchivo = `bitacora_${String(modulo)}.txt`;
      const rutaArchivo = `${carpeta}\\${nombreArchivo}`;
      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });
      const registro = this.formatearRegistroTXT(fecha, usuario, accion, modulo, metadata);

      let lineas: string[] = [];
      if (fs.existsSync(rutaArchivo)) {
        lineas = fs.readFileSync(rutaArchivo, 'utf8').split('\n').filter(l => l.trim());
      }
      const lineasActualizadas = [...lineas.slice(-199), registro];
      fs.writeFileSync(rutaArchivo, lineasActualizadas.join('\n'), 'utf8');
      this.logger.debug(`📝 Archivo documento actualizado: ${rutaArchivo}`);
    } catch (error: any) {
      this.logger.error(`Error guardando archivo documento: ${error.message}`);
    }
  }

  private async guardarEnArchivoGlobal(
    usuario: any,
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const rol = usuario.rol_usuario || usuario.role;
      if (!rol) return;

      const logsDir = `${this.LOGS_BASE_PATH}\\roles\\${rol}`;
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      const nombreArchivo = `${rol}_${año}-${mes}.log`;
      const rutaArchivo = `${logsDir}\\${nombreArchivo}`;

      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });
      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const moduloStr = `[${String(modulo).toUpperCase()}] `;
      const ip = metadata?.ip ? ` (IP: ${metadata.ip})` : '';
      const detalles = metadata?.detalles ? ` - ${metadata.detalles}` : '';
      
      const registro = `[${fecha}] ${usuario.nombre_usuario || usuario.fullName || usuario.username} (${usuario.username})${ip} - ${moduloStr}${radicado}${accion}${detalles}\n`;
      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });
      this.logger.debug(`📝 Archivo rol actualizado: ${rutaArchivo}`);
    } catch (error: any) {
      this.logger.error(`Error en archivo global: ${error.message}`);
    }
  }

  private async guardarEnArchivoModulo(
    modulo: ModuloBitacora | string,
    usuario: any,
    accion: AccionBitacora | string,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const moduloStr = String(modulo);
      const logsDir = `${this.LOGS_BASE_PATH}\\modulos\\${moduloStr}`;
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      const nombreArchivo = `${moduloStr}_${año}-${mes}.log`;
      const rutaArchivo = `${logsDir}\\${nombreArchivo}`;

      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });
      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const usuarioStr = `${usuario.nombre_usuario || usuario.fullName || usuario.username} (${usuario.username})`;
      const ip = metadata?.ip ? ` IP:${metadata.ip}` : '';
      const detalles = metadata?.detalles ? ` - ${metadata.detalles}` : '';
      
      const registro = `[${fecha}] ${usuarioStr}${ip} - ${radicado}${accion}${detalles}\n`;
      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });
      this.logger.debug(`📝 Archivo módulo actualizado: ${rutaArchivo}`);
    } catch (error: any) {
      this.logger.error(`Error en archivo módulo: ${error.message}`);
    }
  }

  private async guardarEnArchivoGeneral(
    usuario: any,
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const logsDir = `${this.LOGS_BASE_PATH}\\general`;
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      const nombreArchivo = `bitacora_general_${año}-${mes}.log`;
      const rutaArchivo = `${logsDir}\\${nombreArchivo}`;

      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });
      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const moduloStr = `[${String(modulo).toUpperCase()}] `;
      const ip = metadata?.ip ? ` (IP: ${metadata.ip})` : '';
      const detalles = metadata?.detalles ? ` - ${metadata.detalles}` : '';
      
      const registro = `[${fecha}] ${usuario.nombre_usuario || usuario.fullName || usuario.username} (${usuario.username})${ip} - ${moduloStr}${radicado}${accion}${detalles}\n`;
      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });
      this.logger.debug(`📝 Archivo general actualizado: ${rutaArchivo}`);
    } catch (error: any) {
      this.logger.error(`Error en archivo general: ${error.message}`);
    }
  }

  private async guardarErrorEnArchivo(
    error: Error,
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    usuario: any,
    documento?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const logsDir = `${this.LOGS_BASE_PATH}\\errores`;
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const fechaActual = new Date();
      const año = fechaActual.getFullYear();
      const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
      const nombreArchivo = `errores_${año}-${mes}.log`;
      const rutaArchivo = `${logsDir}\\${nombreArchivo}`;

      const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });
      const radicado = documento?.numeroRadicado ? `[${documento.numeroRadicado}] ` : '';
      const registro = `[${fecha}] ERROR en ${modulo}/${accion} - Usuario: ${usuario?.username || usuario?.id || 'unknown'} ${radicado}- ${error.message}\n${error.stack}\n---\n`;
      fs.writeFileSync(rutaArchivo, registro, { flag: 'a', encoding: 'utf8' });
    } catch (e) {
      this.logger.error(`Error guardando error: ${e.message}`);
    }
  }

  private formatearRegistroTXT(
    fecha: string,
    usuario: any,
    accion: AccionBitacora | string,
    modulo: ModuloBitacora | string,
    metadata: any
  ): string {
    const rol = usuario.rol_usuario || usuario.role || 'unknown';
    const nombre = usuario.nombre_usuario || usuario.fullName || usuario.username;
    
    let registro = `[${fecha}] ${nombre} (${usuario.username}) - ${rol.toUpperCase()} - [${String(modulo).toUpperCase()}] - ${accion}`;
    if (metadata.detalles) registro += ` | ${metadata.detalles}`;
    if (metadata.numeroArchivo) registro += ` | Archivo #${metadata.numeroArchivo}`;
    if (metadata.nombreArchivo) registro += ` | ${metadata.nombreArchivo}`;
    if (metadata.estadoAnterior && metadata.estadoNuevo) registro += ` | ${metadata.estadoAnterior} → ${metadata.estadoNuevo}`;
    if (metadata.ip && metadata.ip !== 'unknown') registro += ` | IP: ${metadata.ip}`;
    if (metadata.duracionMs) registro += ` | ⏱️ ${metadata.duracionMs}ms`;
    return registro + '\n';
  }

  private generarDescripcion(accion: AccionBitacora | string, metadata: any): string {
    const descripciones: Record<string, string> = {
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
      [AccionBitacora.ADMIN_CREAR_USUARIO]: 'Creación de registro',
      [AccionBitacora.ADMIN_EDITAR_USUARIO]: 'Edición de registro',
      [AccionBitacora.SISTEMA_ERROR]: 'Error en el sistema',
    };
    let desc = descripciones[String(accion)] || String(accion);
    if (metadata?.detalles) desc += `: ${metadata.detalles}`;
    return desc;
  }

  // ==================== MÉTODOS DE CONSULTA ====================

  async consultarPorDocumento(
    documentoId: string,
    options?: { limite?: number; desde?: Date; hasta?: Date; modulo?: ModuloBitacora }
  ): Promise<BitacoraSistema[]> {
    const query = this.bitacoraRepository
      .createQueryBuilder('b')
      .where('b.documento_id = :documentoId', { documentoId })
      .orderBy('b.created_at', 'DESC')
      .take(options?.limite || 100);

    if (options?.desde) query.andWhere('b.created_at >= :desde', { desde: options.desde });
    if (options?.hasta) query.andWhere('b.created_at <= :hasta', { hasta: options.hasta });
    if (options?.modulo) query.andWhere('b.modulo = :modulo', { modulo: options.modulo });
    return query.getMany();
  }

  async consultarPorUsuario(usuarioId: string, limite: number = 100): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { usuario_id: usuarioId },
      order: { created_at: 'DESC' },
      take: limite,
    });
  }

  async consultarPorRol(rol: string, limite: number = 100): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { rol_usuario: rol },
      order: { created_at: 'DESC' },
      take: limite,
    });
  }

  async consultarPorModulo(modulo: ModuloBitacora, limite: number = 100): Promise<BitacoraSistema[]> {
    return this.bitacoraRepository.find({
      where: { modulo: String(modulo) },
      order: { created_at: 'DESC' },
      take: limite,
    });
  }

  async obtenerEstadisticas(desde: Date, hasta: Date = new Date()): Promise<any> {
    const stats = await this.bitacoraRepository
      .createQueryBuilder('b')
      .select('b.modulo', 'modulo')
      .addSelect('b.accion', 'accion')
      .addSelect('COUNT(*)', 'total')
      .where('b.created_at BETWEEN :desde AND :hasta', { desde, hasta })
      .groupBy('b.modulo, b.accion')
      .orderBy('total', 'DESC')
      .getRawMany();

    const total = await this.bitacoraRepository.count({
      where: { created_at: Between(desde, hasta) }
    });

    const porRol = await this.bitacoraRepository
      .createQueryBuilder('b')
      .select('b.rol_usuario', 'rol')
      .addSelect('COUNT(*)', 'total')
      .where('b.created_at BETWEEN :desde AND :hasta', { desde, hasta })
      .groupBy('b.rol_usuario')
      .getRawMany();

    return { total, porModulo: stats, porRol, periodo: { desde, hasta } };
  }

  async obtenerTimelineDocumento(documentoId: string): Promise<any[]> {
    const registros = await this.bitacoraRepository.find({
      where: { documento_id: documentoId },
      order: { created_at: 'ASC' },
    });
    return registros;
  }

  async limpiarRegistrosAntiguos(dias: number = 90): Promise<number> {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - dias);
    const result = await this.bitacoraRepository
      .createQueryBuilder()
      .delete()
      .where('created_at < :fechaLimite', { fechaLimite })
      .execute();
    this.logger.log(`🗑️ Limpiados ${result.affected} registros antiguos (>${dias} días)`);
    return result.affected || 0;
  }

  async obtenerLogsTXT(tipo: 'general' | 'roles' | 'modulos' | 'errores', nombre?: string): Promise<string> {
    try {
      let rutaArchivo = '';
      
      if (tipo === 'general') {
        const fechaActual = new Date();
        const año = fechaActual.getFullYear();
        const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
        rutaArchivo = `${this.LOGS_BASE_PATH}\\general\\bitacora_general_${año}-${mes}.log`;
      } else if (tipo === 'roles' && nombre) {
        const fechaActual = new Date();
        const año = fechaActual.getFullYear();
        const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
        rutaArchivo = `${this.LOGS_BASE_PATH}\\roles\\${nombre}\\${nombre}_${año}-${mes}.log`;
      } else if (tipo === 'modulos' && nombre) {
        const fechaActual = new Date();
        const año = fechaActual.getFullYear();
        const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
        rutaArchivo = `${this.LOGS_BASE_PATH}\\modulos\\${nombre}\\${nombre}_${año}-${mes}.log`;
      } else if (tipo === 'errores') {
        const fechaActual = new Date();
        const año = fechaActual.getFullYear();
        const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
        rutaArchivo = `${this.LOGS_BASE_PATH}\\errores\\errores_${año}-${mes}.log`;
      }

      if (fs.existsSync(rutaArchivo)) {
        return fs.readFileSync(rutaArchivo, 'utf8');
      }
      return 'No hay logs disponibles';
    } catch (error: any) {
      this.logger.error(`Error leyendo archivo TXT: ${error.message}`);
      return `Error al leer logs: ${error.message}`;
    }
  }
}