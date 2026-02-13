import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Body,
  ParseUUIDPipe,
  Res,
  Delete,
  BadRequestException,
  Logger,
  HttpStatus,
  Query,
  HttpException,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as mime from 'mime-types';
import * as crypto from 'crypto';

import { JwtAuthGuard } from './../common/guards/jwt-auth.guard';
import { RolesGuard } from './../common/guards/roles.guard';
import { Roles } from './../auth/decorators/roles.decorator';
import { GetUser } from './../auth/decorators/get-user.decorator';
import { UserRole } from './../users/enums/user-role.enum';
import { ContabilidadService } from './contabilidad.service';
import { ContabilidadEstado, TipoCausacion } from './entities/contabilidad-documento.entity';
import { multerContabilidadConfig } from './../config/multer-contabilidad.config';
import { Public } from './../common/decorators/public.decorator';

// Tipo que coincide exactamente con lo que devuelve JwtStrategy.validate()
type JwtUser = {
    id: string;
    username: string;
    role: string;
    email: string;
};

@Controller('contabilidad')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CONTABILIDAD, UserRole.ADMIN)
export class ContabilidadController {
    private readonly logger = new Logger(ContabilidadController.name);

    constructor(private readonly contabilidadService: ContabilidadService) {}

    // ───────────────────────────────────────────────────────────────
    // DOCUMENTOS DISPONIBLES
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/disponibles')
    async getDocumentosDisponibles(@GetUser() user: JwtUser) {
        return this.contabilidadService.obtenerDocumentosDisponibles(user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // TOMAR DOCUMENTO PARA REVISIÓN
    // ───────────────────────────────────────────────────────────────
    @Post('documentos/:documentoId/tomar')
    async tomarDocumentoParaRevision(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        this.logger.log(`[TOMAR] Contador ${user.id} (${user.username}) tomando documento ${documentoId}`);
        return this.contabilidadService.tomarDocumentoParaRevision(documentoId, user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // MIS DOCUMENTOS EN REVISIÓN
    // ───────────────────────────────────────────────────────────────
    @Get('mis-documentos')
    async getMisDocumentos(@GetUser() user: JwtUser) {
        return this.contabilidadService.obtenerDocumentosEnRevision(user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // DETALLE DE DOCUMENTO
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/:documentoId')
    async getDetalleDocumento(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        this.logger.log(`[DETALLE] Contador ${user.id} (${user.username}) solicitando detalle ${documentoId}`);
        return this.contabilidadService.obtenerDetalleDocumento(documentoId, user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // DEFINIR GLOSA
    // ───────────────────────────────────────────────────────────────
    @Post('documentos/:documentoId/definir-glosa')
    async definirGlosa(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
        @Body() body: { tieneGlosa: boolean }
    ) {
        if (typeof body.tieneGlosa !== 'boolean') {
            throw new BadRequestException('El campo tieneGlosa debe ser booleano');
        }
        return this.contabilidadService.definirGlosa(documentoId, user.id, body.tieneGlosa);
    }

    // ───────────────────────────────────────────────────────────────
    // SUBIR DOCUMENTOS DE CONTABILIDAD
    // ───────────────────────────────────────────────────────────────
@Post('documentos/:documentoId/subir-documentos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CONTABILIDAD, UserRole.ADMIN) // Ambos roles permitidos
@UseInterceptors(
    FileFieldsInterceptor(
        [
            { name: 'glosa', maxCount: 1 },
            { name: 'causacion', maxCount: 1 },
            { name: 'extracto', maxCount: 1 },
            { name: 'comprobanteEgreso', maxCount: 1 },
        ],
        multerContabilidadConfig
    ),
)
async subirDocumentosContabilidad(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
    @Body() body: any,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
) {
    this.logger.log(`[SUBIR] Usuario ${user.id} (${user.username}) con rol ${user.role} subiendo para ${documentoId}`);
        // DEBUG: Verificar archivos recibidos
        if (files) {
            this.logger.debug(`📁 Archivos recibidos en controller (${Object.keys(files).length}):`);
            Object.keys(files).forEach(key => {
                const fileArray = files[key];
                if (fileArray && fileArray.length > 0) {
                    const file = fileArray[0];
                    this.logger.debug(`  ${key}: ${file.originalname} - ${file.size} bytes - Buffer: ${file.buffer ? 'YES' : 'NO'}`);
                }
            });
        } else {
            this.logger.warn('⚠️ No se recibieron archivos');
        }

        const datos = {
            observaciones: body.observaciones,
            tieneGlosa: body.tieneGlosa ? JSON.parse(body.tieneGlosa) : undefined,
            estadoFinal: body.estadoFinal,
            tipoProceso: body.tipoProceso,
            tipoCausacion: body.tipoCausacion as TipoCausacion,
        };

        return this.contabilidadService.subirDocumentosContabilidad(
            documentoId,
            user.id,
            datos,
            files,
        );
    }

    // ───────────────────────────────────────────────────────────────
    // FINALIZAR REVISIÓN
    // ───────────────────────────────────────────────────────────────
    @Put('documentos/:documentoId/finalizar')
    async finalizarRevision(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
        @Body() body: { estado: ContabilidadEstado; observaciones?: string }
    ) {
        this.logger.log(`[FINALIZAR] Contador ${user.id} (${user.username}) finalizando ${documentoId}`);

        if (!body.estado || !Object.values(ContabilidadEstado).includes(body.estado)) {
            throw new BadRequestException('Estado inválido');
        }

        return this.contabilidadService.finalizarRevision(
            documentoId,
            user.id,
            body.estado,
            body.observaciones
        );
    }

    // ───────────────────────────────────────────────────────────────
    // LIBERAR DOCUMENTO
    // ───────────────────────────────────────────────────────────────
    @Delete('documentos/:documentoId/liberar')
    async liberarDocumento(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        return this.contabilidadService.liberarDocumento(documentoId, user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // DESCARGAR ARCHIVO
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/:documentoId/descargar/:tipo')
    async descargarArchivoContabilidad(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @Param('tipo') tipo: string,
        @GetUser() user: JwtUser,
        @Res() res: Response,
    ) {
        const { ruta, nombre } = await this.contabilidadService.descargarArchivoContabilidad(
            documentoId,
            tipo,
            user.id
        );
        res.download(ruta, nombre);
    }

    // ───────────────────────────────────────────────────────────────
    // PREVISUALIZAR ARCHIVO (PÚBLICO)
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/:documentoId/archivo/:tipo')
    @Public()
    async previsualizarArchivoContabilidad(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @Param('tipo') tipo: string,
        @Query('download') download: string = 'false',
        @Res() res: Response,
    ) {
        this.logger.log(`[PUBLIC-PREVIEW] Acceso público → ${documentoId}/${tipo}`);

        try {
            const { rutaAbsoluta, nombreArchivo } = await this.contabilidadService.obtenerRutaArchivoContabilidadFull(
                documentoId,
                tipo,
                undefined
            );

            if (!fs.existsSync(rutaAbsoluta)) {
                this.logger.error(`[PUBLIC-PREVIEW 404] No existe: ${rutaAbsoluta}`);
                return res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado' });
            }

            const ext = path.extname(nombreArchivo).toLowerCase();

            if (['.doc', '.docx'].includes(ext) && download !== 'true') {
                const tmpPdf = path.join(os.tmpdir(), `preview-${crypto.randomUUID()}.pdf`);
                try {
                    await this.contabilidadService.convertirWordAPdf(rutaAbsoluta, tmpPdf);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', 'inline; filename="vista.pdf"');
                    const stream = fs.createReadStream(tmpPdf);
                    stream.on('end', () => fs.unlink(tmpPdf, () => {}));
                    return stream.pipe(res);
                } catch (e) {
                    this.logger.error(`[CONVERSIÓN ERROR] ${e.message}`);
                }
            }

            const mimeType = mime.lookup(ext) || 'application/octet-stream';
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Disposition', download === 'true' ? `attachment; filename="${nombreArchivo}"` : 'inline');
            return fs.createReadStream(rutaAbsoluta).pipe(res);
        } catch (error: any) {
            this.logger.error(`[PUBLIC-PREVIEW ERROR] ${error.message}`);
            res.status(500).json({ message: error.message || 'Error al procesar archivo' });
        }
    }

    // ───────────────────────────────────────────────────────────────
    // MIS AUDITORÍAS
    // ───────────────────────────────────────────────────────────────
    @Get('mis-auditorias')
    async getMisAuditorias(@GetUser() user: JwtUser) {
        this.logger.log(`[MIS-AUDITORIAS] Usuario: ${user.id} (${user.username})`);
        return this.contabilidadService.obtenerMisAuditorias(user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // DOCUMENTO PARA VISTA
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/:documentoId/vista')
    async getDocumentoParaVista(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        return this.contabilidadService.obtenerDocumentoParaVista(documentoId, user.id);
    }

    // ───────────────────────────────────────────────────────────────
    // HISTORIAL
    // ───────────────────────────────────────────────────────────────
    @Get('historial')
    async getHistorial(@GetUser() user: JwtUser) {
        this.logger.log(`[HISTORIAL] Contador ${user.id} (${user.username}) solicitando historial`);

        try {
            const historial = await this.contabilidadService.getHistorial(user.id);

            return {
                success: true,
                message: `Historial cargado (${historial.length} registros)`,
                data: historial
            };
        } catch (error) {
            this.logger.error(`Error obteniendo historial: ${error.message}`);
            throw new HttpException(
                { success: false, message: error.message || 'Error al cargar historial' },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    // ───────────────────────────────────────────────────────────────
    // DIAGNÓSTICO DE SUBIDA
    // ───────────────────────────────────────────────────────────────
    @Post('diagnostico-subida')
    @UseInterceptors(
        FileFieldsInterceptor([
            { name: 'testFile', maxCount: 1 }
        ], multerContabilidadConfig)
    )
    async diagnosticoSubida(
        @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
        @Res() res: Response
    ) {
        const file = files['testFile']?.[0];

        if (!file) {
            return res.status(400).json({
                error: 'No se recibió archivo',
                filesReceived: Object.keys(files)
            });
        }

        return res.json({
            success: true,
            fileName: file.originalname,
            fileSize: file.size,
            hasBuffer: !!file.buffer,
            bufferLength: file.buffer?.length || 0,
            mimetype: file.mimetype,
            fieldname: file.fieldname
        });
    }

    // ───────────────────────────────────────────────────────────────
    // RECHAZADOS VISIBLES
    // ───────────────────────────────────────────────────────────────
    @Get('rechazados-visibles')
    async obtenerRechazadosVisibles(@GetUser() user: JwtUser) {
        const docs = await this.contabilidadService.obtenerRechazadosVisibles(user);
        return {
            success: true,
            count: docs.length,
            data: docs
        };
    }

    // ───────────────────────────────────────────────────────────────
    // OBTENER SOLO CONTABILIDAD
    // ───────────────────────────────────────────────────────────────
    @Get('documentos/:id/contabilidad')
    async obtenerSoloContabilidad(
        @Param('id') id: string,
        @Req() req: Request,
    ) {
        const user = req.user as { id: string; username: string; role: string; email: string };

        if (!user?.id) {
            throw new NotFoundException('Usuario no identificado en el token');
        }

        const contabilidad = await this.contabilidadService.obtenerContabilidadDocumento(id, user.id);

        if (!contabilidad) {
            throw new NotFoundException('No hay registro contable para este documento o no fuiste quien lo procesó');
        }

        return {
            success: true,
            data: {
                estado: contabilidad.estado,
                tipoProceso: contabilidad.tipoProceso,
                observaciones: contabilidad.observaciones,
                tieneGlosa: contabilidad.tieneGlosa,
                tipoCausacion: contabilidad.tipoCausacion,
                glosaPath: contabilidad.glosaPath,
                causacionPath: contabilidad.causacionPath,
                extractoPath: contabilidad.extractoPath,
                comprobanteEgresoPath: contabilidad.comprobanteEgresoPath,
                fechaFinRevision: contabilidad.fechaFinRevision,
                contador: contabilidad.contador?.fullName || contabilidad.contador?.username || 'Contador',
            },
        };
    }
}