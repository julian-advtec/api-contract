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
    InternalServerErrorException
} from '@nestjs/common';
import * as multer from 'multer';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
import { TesoreriaService } from './tesoreria.service';
import { TesoreriaEstado } from './entities/tesoreria-documento.entity';
import { multerTesoreriaConfig } from '../config/multer-tesoreria.config';
import { Public } from './../common/decorators/public.decorator';

type JwtUser = {
    id: string;
    username: string;
    role: string;
    email: string;
};

@Controller('tesoreria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TESORERIA, UserRole.ADMIN)
export class TesoreriaController {
    private readonly logger = new Logger(TesoreriaController.name);

    constructor(private readonly tesoreriaService: TesoreriaService) { }

    @Get('documentos/disponibles')
    async getDocumentosDisponibles(@GetUser() user: JwtUser) {
        return this.tesoreriaService.obtenerDocumentosDisponibles(user.id);
    }

    @Post('documentos/:documentoId/tomar')
    async tomarDocumentoParaRevision(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        this.logger.log(`[TOMAR] Tesorero ${user.id} (${user.username}) tomando documento ${documentoId}`);
        return this.tesoreriaService.tomarDocumentoParaRevision(documentoId, user.id);
    }

    @Get('mis-documentos')
    async getMisDocumentos(@GetUser() user: JwtUser) {
        return this.tesoreriaService.obtenerDocumentosEnRevision(user.id);
    }

    @Get('documentos/:documentoId')
    async getDetalleDocumento(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        this.logger.log(`[DETALLE] Tesorero ${user.id} (${user.username}) solicitando detalle ${documentoId}`);
        return this.tesoreriaService.obtenerDetalleDocumento(documentoId, user.id);
    }

    @Post('documentos/:documentoId/subir-documento')
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'pagoRealizado', maxCount: 1 }
            ],
            multerTesoreriaConfig
        ),
    )
    async subirDocumentoTesoreria(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
        @Body() body: any,
        @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
    ) {
        this.logger.log(`[SUBIR] Tesorero ${user.id} subiendo pago para ${documentoId}`);
        this.logger.log(`📥 signatureId: ${body.signatureId}`);
        this.logger.log(`📥 signaturePosition: ${body.signaturePosition}`);

        const datos = {
            observaciones: body.observaciones,
            estadoFinal: body.estadoFinal,
            signatureId: body.signatureId, // 👈 AGREGAR
            signaturePosition: body.signaturePosition // 👈 AGREGAR
        };

        return this.tesoreriaService.subirDocumentoTesoreria(
            documentoId,
            user.id,
            datos,
            files,
        );
    }

    @Put('documentos/:documentoId/finalizar')
    async finalizarRevision(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
        @Body() body: { estado: TesoreriaEstado; observaciones?: string }
    ) {
        this.logger.log(`[FINALIZAR] Tesorero ${user.id} (${user.username}) finalizando ${documentoId}`);

        if (!body.estado || !Object.values(TesoreriaEstado).includes(body.estado)) {
            throw new BadRequestException('Estado inválido');
        }

        return this.tesoreriaService.finalizarRevision(
            documentoId,
            user.id,
            body.estado,
            body.observaciones
        );
    }

    @Delete('documentos/:documentoId/liberar')
    async liberarDocumento(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        return this.tesoreriaService.liberarDocumento(documentoId, user.id);
    }

    @Get('documentos/:documentoId/descargar/:tipo')
    async descargarArchivoTesoreria(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @Param('tipo') tipo: string,
        @GetUser() user: JwtUser,
        @Res() res: Response,
    ) {
        const { ruta, nombre } = await this.tesoreriaService.descargarArchivoTesoreria(
            documentoId,
            tipo,
            user.id
        );
        res.download(ruta, nombre);
    }

    @Get('documentos/:documentoId/archivo/:tipo')
    @Public() // O con autenticación según tu necesidad
    async previsualizarArchivoTesoreria(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @Param('tipo') tipo: string,
        @Query('download') download: string = 'false',
        @Res() res: Response,
    ) {
        this.logger.log(`[PUBLIC-PREVIEW] Acceso público → ${documentoId}/${tipo}`);

        try {
            // Obtener la ruta del archivo (sin userId para acceso público)
            const { rutaAbsoluta, nombreArchivo } = await this.tesoreriaService.obtenerRutaArchivoTesoreriaFull(
                documentoId,
                tipo,
                undefined // undefined para no requerir userId
            );

            this.logger.log(`[PUBLIC-PREVIEW] Ruta encontrada: ${rutaAbsoluta}`);

            if (!fs.existsSync(rutaAbsoluta)) {
                this.logger.error(`[PUBLIC-PREVIEW 404] No existe: ${rutaAbsoluta}`);
                return res.status(HttpStatus.NOT_FOUND).json({ message: 'Archivo no encontrado' });
            }

            const ext = path.extname(nombreArchivo).toLowerCase();
            const mimeType = mime.lookup(ext) || 'application/octet-stream';

            // Para vista previa (download=false), usar inline
            // Para descarga (download=true), usar attachment
            const contentDisposition = download === 'true'
                ? `attachment; filename="${nombreArchivo}"`
                : 'inline';

            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Disposition', contentDisposition);

            const stream = fs.createReadStream(rutaAbsoluta);
            stream.pipe(res);

        } catch (error: any) {
            this.logger.error(`[PUBLIC-PREVIEW ERROR] ${error.message}`);
            res.status(500).json({ message: error.message || 'Error al procesar archivo' });
        }
    }

    @Get('mis-procesos')
    async getMisProcesos(@GetUser() user: JwtUser) {
        this.logger.log(`[MIS-PROCESOS] Usuario: ${user.id} (${user.username})`);
        return this.tesoreriaService.obtenerMisProcesos(user.id);
    }

    @Get('documentos/:documentoId/vista')
    async getDocumentoParaVista(
        @Param('documentoId', ParseUUIDPipe) documentoId: string,
        @GetUser() user: JwtUser,
    ) {
        return this.tesoreriaService.obtenerDocumentoParaVista(documentoId, user.id);
    }

    @Get('historial')
    async getHistorial(@GetUser() user: JwtUser) {
        this.logger.log(`[HISTORIAL] Tesorero ${user.id} (${user.username}) solicitando historial`);

        try {
            const historial = await this.tesoreriaService.getHistorial(user.id);

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

    @Post('diagnostico-subida')
    @UseInterceptors(
        FileFieldsInterceptor([
            { name: 'testFile', maxCount: 1 }
        ], multerTesoreriaConfig)
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

@Get('rechazados-visibles')
async obtenerRechazadosVisibles(@GetUser() user: JwtUser) {
  const docs = await this.tesoreriaService.obtenerRechazadosVisibles(user);
  return {
    success: true,
    count: docs.length,
    data: docs // ← Esto es el array directamente
  };
}

    @Get('test-metadata')
    async testMetadata() {
        const count = await this.tesoreriaService.getTesoreriaCount();
        return { success: true, count };
    }

}