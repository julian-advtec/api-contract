// src/auxiliar-auditor/auxiliar-auditor.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../common/storage/storage.service';
import * as path from 'path';
import { JuridicaService } from '../juridica/juridica.service';  // ✅ AGREGAR

@Injectable()
export class AuxiliarAuditorService {
    private readonly logger = new Logger(AuxiliarAuditorService.name);

    constructor(
        @InjectRepository(Documento)
        private documentoRepository: Repository<Documento>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        private storageService: StorageService,
        private juridicaService: JuridicaService,
    ) { }

    /**
     * Obtener documentos disponibles para subir acta
     * Solo documentos en estado RADICADO que NO tienen acta
     */
    async obtenerDocumentosDisponibles(auxiliarId: string): Promise<any[]> {
        this.logger.log(`📋 Auxiliar ${auxiliarId} solicitando documentos disponibles`);

        // Buscar documentos en estado RADICADO que NO tienen acta de supervisión
        const documentos = await this.documentoRepository
            .createQueryBuilder('documento')
            .leftJoinAndSelect('documento.radicador', 'radicador')
            .where('documento.estado = :estado', { estado: 'RADICADO' })
            .andWhere('documento.actaSupervisionPath IS NULL')
            .orderBy('documento.fechaRadicacion', 'ASC')
            .getMany();

        this.logger.log(`✅ Encontrados ${documentos.length} documentos sin acta de supervisión`);

        return documentos.map(doc => ({
            id: doc.id,
            numeroRadicado: doc.numeroRadicado,
            numeroContrato: doc.numeroContrato,
            nombreContratista: doc.nombreContratista,
            documentoContratista: doc.documentoContratista,
            fechaInicio: doc.fechaInicio,
            fechaFin: doc.fechaFin,
            fechaRadicacion: doc.fechaRadicacion,
            radicador: doc.nombreRadicador,
            observacion: doc.observacion || '',
            estado: doc.estado,
        }));
    }

    /**
     * Obtener detalle completo del documento (información general)
     */
    async obtenerDetalleDocumento(documentoId: string, auxiliarId: string): Promise<any> {
        this.logger.log(`🔍 Auxiliar ${auxiliarId} obteniendo detalle del documento ${documentoId}`);

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        // Verificar que el documento esté en estado RADICADO o que ya tenga acta
        if (documento.estado !== 'RADICADO' && documento.estado !== 'CON_ACTA') {
            throw new ForbiddenException('Este documento no está disponible para visualización');
        }

        // ✅ OBTENER DATOS DEL CONTRATO (para email y teléfono del proveedor)
        let emailContratista = documento.emailContratista || '';
        let telefonoContratista = documento.telefonoContratista || '';

        try {
            const contrato = await this.juridicaService.buscarContratoPorNumero(documento.numeroContrato);
            if (contrato && contrato.proveedor) {
                emailContratista = contrato.proveedor.email || emailContratista;
                telefonoContratista = contrato.proveedor.telefono || telefonoContratista;
                this.logger.log(`📧 Email desde contrato: ${emailContratista}, 📞 Teléfono: ${telefonoContratista}`);
            }
        } catch (error) {
            this.logger.warn(`⚠️ No se pudo obtener datos del contrato: ${error.message}`);
        }

        // Preparar información de archivos radicados
        const archivosRadicados = [
            { numero: 1, nombre: documento.cuentaCobro, descripcion: documento.descripcionCuentaCobro, existe: !!documento.cuentaCobro },
            { numero: 2, nombre: documento.seguridadSocial, descripcion: documento.descripcionSeguridadSocial, existe: !!documento.seguridadSocial },
            { numero: 3, nombre: documento.informeActividades, descripcion: documento.descripcionInformeActividades, existe: !!documento.informeActividades },
        ];

        return {
            documento: {
                id: documento.id,
                numeroRadicado: documento.numeroRadicado,
                numeroContrato: documento.numeroContrato,
                nombreContratista: documento.nombreContratista,
                documentoContratista: documento.documentoContratista,
                emailContratista: emailContratista,        // ✅ AHORA VIENE DEL CONTRATO
                telefonoContratista: telefonoContratista,  // ✅ AHORA VIENE DEL CONTRATO
                fechaInicio: documento.fechaInicio,
                fechaFin: documento.fechaFin,
                fechaRadicacion: documento.fechaRadicacion,
                radicador: documento.nombreRadicador,
                observacion: documento.observacion,
                estado: documento.estado,
                primerRadicadoDelAno: documento.primerRadicadoDelAno,
                tieneActa: !!documento.actaSupervisionPath,
                actaNombre: documento.actaSupervisionNombre,
                actaSubidaPor: documento.actaSupervisionSubidaPor,
                actaFecha: documento.actaSupervisionFecha,
            },
            archivosRadicados,
            historial: documento.historialEstados || [],
        };
    }

  /**
 * Subir acta de supervisión
 */
async subirActaSupervision(
    documentoId: string,
    auxiliarId: string,
    file: Express.Multer.File,
): Promise<any> {
    this.logger.log(`📤 Auxiliar ${auxiliarId} subiendo acta para documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador'],
    });

    if (!documento) {
        throw new NotFoundException('Documento no encontrado');
    }

    // Verificar que esté en estado RADICADO
    if (documento.estado !== 'RADICADO') {
        throw new BadRequestException(
            `El documento está en estado "${documento.estado}". Solo puede subir acta cuando está RADICADO.`
        );
    }

    // Verificar si ya tiene acta
    if (documento.actaSupervisionPath) {
        throw new BadRequestException('Este documento ya tiene un acta de supervisión');
    }

    const auxiliar = await this.userRepository.findOne({
        where: { id: auxiliarId }
    });

    if (!auxiliar) {
        throw new ForbiddenException('Usuario auxiliar no encontrado');
    }

    // Generar nombre de archivo seguro
    const extension = path.extname(file.originalname).toLowerCase();
    const nombreArchivo = `acta_supervision_${documento.numeroRadicado}${extension}`;

    // ✅ CORREGIDO: Guardar solo el nombre del archivo (no la ruta completa)
    // La carpeta se define en el storageService, pero en la BD solo guardamos el nombre
    const relativePath = nombreArchivo; // ✅ SOLO EL NOMBRE DEL ARCHIVO

    this.logger.log(`📂 Subiendo acta con nombre: ${relativePath}`);

    // Subir archivo usando StorageService - pasar la carpeta por separado
    const folderPath = path.join(
        documento.documentoContratista,
        documento.numeroRadicado.substring(1, 5),
        documento.numeroContrato,
        documento.numeroRadicado
    ).replace(/\\/g, '/');

    // Usar uploadFileFromBuffer para controlar mejor la ruta
    const result = await this.storageService.uploadFileFromBuffer(
        file.buffer,
        nombreArchivo,
        file.mimetype,
        folderPath
    );

    // ✅ GUARDAR SOLO EL NOMBRE DEL ARCHIVO (no la ruta completa)
    documento.actaSupervisionPath = nombreArchivo;  // ✅ SOLO EL NOMBRE
    documento.actaSupervisionNombre = nombreArchivo;
    documento.actaSupervisionSubidaPor = auxiliar.username;
    documento.actaSupervisionFecha = new Date();

    // Cambiar estado para indicar que ya tiene acta
    documento.estado = 'CON_ACTA';
    documento.fechaActualizacion = new Date();
    documento.ultimoUsuario = `Auxiliar: ${auxiliar.username}`;

    // Agregar al historial
    const historial = documento.historialEstados || [];
    historial.push({
        fecha: new Date(),
        estado: 'CON_ACTA',
        usuarioId: auxiliar.id,
        usuarioNombre: auxiliar.fullName || auxiliar.username,
        rolUsuario: auxiliar.role,
        observacion: `Acta de supervisión subida por auxiliar ${auxiliar.username}`
    });
    documento.historialEstados = historial;

    const savedDocumento = await this.documentoRepository.save(documento);

    this.logger.log(`✅ Acta subida para ${documento.numeroRadicado}, ahora en estado CON_ACTA`);
    this.logger.log(`   Ruta guardada: ${documento.actaSupervisionPath}`);

    return {
        documentoId: savedDocumento.id,
        numeroRadicado: savedDocumento.numeroRadicado,
        estado: savedDocumento.estado,
        actaNombre: nombreArchivo,
        actaFecha: savedDocumento.actaSupervisionFecha,
    };
}

    /**
     * Obtener acta de supervisión para descargar
     */
    async obtenerActaSupervision(
        documentoId: string,
        auxiliarId: string,
    ): Promise<{ buffer: Buffer; mimeType: string; nombre: string }> {
        this.logger.log(`📥 Auxiliar ${auxiliarId} obteniendo acta del documento ${documentoId}`);

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId }
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        if (!documento.actaSupervisionPath) {
            throw new NotFoundException('Este documento no tiene acta de supervisión');
        }

        const buffer = await this.storageService.getFile(documento.actaSupervisionPath);
        const extension = path.extname(documento.actaSupervisionPath).toLowerCase();

        const mimeTypes: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };

        return {
            buffer,
            mimeType: mimeTypes[extension] || 'application/octet-stream',
            nombre: documento.actaSupervisionNombre || 'acta_supervision.pdf',
        };
    }
}