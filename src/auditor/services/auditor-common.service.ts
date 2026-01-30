// src/auditor/services/auditor-common.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AuditorCommonService {
  private readonly logger = new Logger(AuditorCommonService.name);

  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * Genera un nombre de archivo seguro y único
   * @param tipo - rp, cdp, poliza, etc.
   * @param radicado - número de radicado (ej: R2025-007)
   * @param extension - .pdf, .docx, etc.
   */
  crearNombreArchivoSeguro(tipo: string, radicado: string, extension: string): string {
    const nombreLimpio = tipo
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w._-]/g, '');

    const randomName = Array(8)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    return `${nombreLimpio}_${radicado}-${randomName}${extension}`;
  }

  /**
   * Busca archivos en una carpeta usando patrones inteligentes
   * @param rutaCarpeta Ruta absoluta de la carpeta (ej: .../R2025-007/auditor)
   * @param numeroRadicado Para filtrar por coincidencia
   */
  buscarArchivosEnCarpeta(
    rutaCarpeta: string,
    numeroRadicado: string,
  ): {
    rp: string | null;
    cdp: string | null;
    poliza: string | null;
    certificadoBancario: string | null;
    minuta: string | null;
    actaInicio: string | null;
  } {
    const resultado: Record<'rp' | 'cdp' | 'poliza' | 'certificadoBancario' | 'minuta' | 'actaInicio', string | null> = {
      rp: null,
      cdp: null,
      poliza: null,
      certificadoBancario: null,
      minuta: null,
      actaInicio: null,
    };

    if (!rutaCarpeta || !fs.existsSync(rutaCarpeta)) {
      this.logger.warn(`Carpeta no existe: ${rutaCarpeta}`);
      return resultado;
    }

    try {
      const archivos = fs.readdirSync(rutaCarpeta);
      const ignorar = [/_meta\.json$/, /\.tmp$/, /~$/, /^\./, /Thumbs\.db/i, /desktop\.ini/i];

      const patrones: Record<keyof typeof resultado, RegExp[]> = {
        rp: [/rp.*${numeroRadicado}/i, /resoluci[oó]n.*pago/i, /rp[_-]/i, /^rp/i, /.*pago.*/i],
        cdp: [/cdp.*${numeroRadicado}/i, /certificado.*disponibilidad/i, /cdp[_-]/i, /^cdp/i, /.*disponibilidad.*/i],
        poliza: [/poliza.*${numeroRadicado}/i, /p[oó]liza.*cumplimiento/i, /poliza[_-]/i, /^poliza/i, /.*cumplimiento.*/i],
        certificadoBancario: [
          /certificado.*bancario.*${numeroRadicado}/i,
          /certificado.*bancario/i,
          /certificado[_-]bancario/i,
          /.*bancario.*/i,
          /.*banco.*/i,
        ],
        minuta: [/minuta.*${numeroRadicado}/i, /minuta.*contrato/i, /minuta[_-]/i, /^minuta/i, /.*contrato.*/i],
        actaInicio: [/acta.*inicio.*${numeroRadicado}/i, /acta.*de.*inicio/i, /acta[_-]inicio/i, /^acta/i, /.*inicio.*/i],
      };

      archivos.forEach((archivo) => {
        const nombreLower = archivo.toLowerCase();
        if (ignorar.some((regex) => regex.test(nombreLower))) return;

        (Object.keys(patrones) as (keyof typeof resultado)[]).forEach((tipo) => {
          if (resultado[tipo] !== null) return; // ya encontrado

          const regexList = patrones[tipo];
          if (regexList.some((regex) => regex.test(nombreLower))) {
            resultado[tipo] = archivo;
            this.logger.debug(`Encontrado ${tipo.toUpperCase()}: ${archivo}`);
          }
        });
      });

      return resultado;
    } catch (error) {
      this.logger.error(`Error leyendo carpeta ${rutaCarpeta}: ${error.message}`);
      return resultado;
    }
  }

  /**
   * Encuentra la carpeta auditor efectiva (del primer radicado del contrato)
   */
  async obtenerCarpetaAuditoriaEfectiva(documentoId: string): Promise<{
    carpeta: string;
    radicadoReferencia: string;
    esPrimer: boolean;
    nota: string;
    primerRadicado?: Documento;
  }> {
    const doc = await this.documentoRepository.findOne({
      where: { id: documentoId },
    });

    if (!doc) {
      throw new NotFoundException('Documento no encontrado');
    }

    if (doc.primerRadicadoDelAno) {
      return {
        carpeta: path.join(doc.rutaCarpetaRadicado, 'auditor'),
        radicadoReferencia: doc.numeroRadicado,
        esPrimer: true,
        nota: '',
        primerRadicado: doc,
      };
    }

    const primerRadicado = await this.documentoRepository.findOne({
      where: {
        numeroContrato: doc.numeroContrato,
        primerRadicadoDelAno: true,
      },
      order: { fechaRadicacion: 'ASC' },
    });

    if (!primerRadicado?.rutaCarpetaRadicado) {
      this.logger.warn(`No se encontró primer radicado para contrato ${doc.numeroContrato}`);
      return {
        carpeta: '',
        radicadoReferencia: '',
        esPrimer: false,
        nota: 'No se encontró primer radicado del contrato',
      };
    }

    return {
      carpeta: path.join(primerRadicado.rutaCarpetaRadicado, 'auditor'),
      radicadoReferencia: primerRadicado.numeroRadicado,
      esPrimer: false,
      nota: `Documentos del primer radicado ${primerRadicado.numeroRadicado}`,
      primerRadicado,
    };
  }

  /**
   * Registra acceso de auditor en un archivo txt dentro de la carpeta
   */
  async registrarAccesoAuditor(
    rutaCarpeta: string,
    auditorId: string,
    accion: string,
    detallesExtra?: string,
  ): Promise<void> {
    try {
      if (!rutaCarpeta) {
        this.logger.warn('No hay rutaCarpeta para registrar acceso');
        return;
      }

      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_auditor.txt');
      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long',
      });

      const auditor = await this.userRepository.findOne({ where: { id: auditorId } });
      const nombreAuditor = auditor?.fullName || auditor?.username || 'Auditor desconocido';

      let registro = `[${fecha}] ${nombreAuditor} (${auditor?.username || auditorId}) - AUDITOR - ${accion}`;
      if (detallesExtra) registro += ` | ${detallesExtra}`;
      registro += '\n';

      let contenidoExistente = '';
      if (fs.existsSync(rutaArchivo)) {
        contenidoExistente = fs.readFileSync(rutaArchivo, 'utf8');
      }

      const lineas = contenidoExistente.split('\n');
      const lineasActualizadas = [...lineas.slice(-99), registro]; // mantener últimas 100 líneas

      fs.writeFileSync(rutaArchivo, lineasActualizadas.join('\n'), 'utf8');
      this.logger.log(`📝 Registro auditor actualizado: ${rutaArchivo} - ${accion}`);
    } catch (error) {
      this.logger.error(`⚠️ Error registrando acceso auditor: ${error.message}`);
    }
  }

  /**
   * Crea lista de archivos vacíos cuando no hay documentos
   */
  crearArchivosAuditorVacios(nota: string = 'No disponible') {
    return [
      { tipo: 'rp', descripcion: 'Resolución de Pago', subido: false, nombreArchivo: '', rutaServidor: null, nota },
      { tipo: 'cdp', descripcion: 'Certificado de Disponibilidad Presupuestal', subido: false, nombreArchivo: '', rutaServidor: null, nota },
      { tipo: 'poliza', descripcion: 'Póliza', subido: false, nombreArchivo: '', rutaServidor: null, nota },
      { tipo: 'certificadoBancario', descripcion: 'Certificado Bancario', subido: false, nombreArchivo: '', rutaServidor: null, nota },
      { tipo: 'minuta', descripcion: 'Minuta', subido: false, nombreArchivo: '', rutaServidor: null, nota },
      { tipo: 'actaInicio', descripcion: 'Acta de Inicio', subido: false, nombreArchivo: '', rutaServidor: null, nota },
    ];
  }

  /**
   * Lista de documentos faltantes según entidad AuditorDocumento
   */
  obtenerDocumentosFaltantes(auditorDoc: any): string[] {
    const faltantes: string[] = [];
    if (!auditorDoc.rpPath) faltantes.push('rp');
    if (!auditorDoc.cdpPath) faltantes.push('cdp');
    if (!auditorDoc.polizaPath) faltantes.push('poliza');
    if (!auditorDoc.certificadoBancarioPath) faltantes.push('certificadoBancario');
    if (!auditorDoc.minutaPath) faltantes.push('minuta');
    if (!auditorDoc.actaInicioPath) faltantes.push('actaInicio');
    return faltantes;
  }
}