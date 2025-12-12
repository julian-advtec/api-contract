import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFiles,
    Req,
    Res,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { RadicacionService } from './radicacion.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import * as fs from 'fs';
import * as path from 'path';

@Controller('radicacion')
export class RadicacionController {
    private readonly logger = new Logger(RadicacionController.name);

    constructor(private readonly radicacionService: RadicacionService) { }

    // ========== ENDPOINTS PÚBLICOS/SIN PARÁMETROS PRIMERO ==========

    /**
     * Health check - SIN autenticación
     */
    @Get('health')
    async healthCheck() {
        return {
            status: 'ok',
            service: 'radicacion',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
        };
    }

    /**
     * Test endpoint - SIN autenticación
     */
    @Get('test')
    async testEndpoint() {
        return {
            success: true,
            message: 'Radicación API está funcionando',
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Endpoint para debugging - información del usuario
     */
    @Get('debug/user-info')
    @UseGuards(JwtAuthGuard)
    async debugUserInfo(@Req() req: Request) {
        const user = req.user as any;

        this.logger.log(`🔍 Debug info solicitada por usuario: ${user.username} (${user.role})`);

        return {
            success: true,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    fullName: user.fullName,
                    normalizedRole: user.role ? user.role.toString().toUpperCase() : 'UNDEFINED'
                },
                permissions: {
                    canRadicar: [UserRole.RADICADOR, UserRole.ADMIN].includes(user.role),
                    canView: [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS].includes(user.role)
                },
                timestamp: new Date().toISOString(),
            }
        };
    }

    /**
     * Endpoint para verificar permisos del usuario
     */
    @Get('verificar/permisos')
    @UseGuards(JwtAuthGuard)
    async verificarPermisos(@Req() req: Request) {
        const user = req.user as any;

        this.logger.log(`🔐 Verificando permisos para usuario: ${user.username} (${user.role})`);

        const userRole = user.role?.toString().toUpperCase();

        const puedeRadicar = [UserRole.RADICADOR, UserRole.ADMIN]
            .map(r => r.toString().toUpperCase())
            .includes(userRole);

        const puedeVer = [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS]
            .map(r => r.toString().toUpperCase())
            .includes(userRole);

        const puedeDescargar = [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS]
            .map(r => r.toString().toUpperCase())
            .includes(userRole);

        return {
            success: true,
            data: {
                puedeRadicar,
                puedeVer,
                puedeDescargar,
                usuario: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    nombreCompleto: user.fullName || user.username,
                    email: user.email,
                    normalizedRole: userRole
                },
                rolesPermitidos: {
                    radicar: [UserRole.RADICADOR, UserRole.ADMIN],
                    ver: [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS],
                    descargar: [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS]
                },
                timestamp: new Date().toISOString(),
            },
        };
    }

    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS)
    async findAll(@Req() req: Request) {
        try {
            const user = req.user as any;
            this.logger.log(`📋 Usuario ${user.username} (${user.role}) listando documentos`);

            const documentos = await this.radicacionService.findAll(user);

            return {
                success: true,
                count: documentos.length,
                data: documentos,
            };
        } catch (error) {
            this.logger.error('❌ Error obteniendo documentos:', error.message);
            const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
            throw new HttpException(
                {
                    success: false,
                    message: error.message || 'Error al obtener documentos',
                },
                status,
            );
        }
    }

    // ========== ENDPOINTS CON PARÁMETROS DESPUÉS ==========

    @Get(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
    async findOne(@Param('id') id: string, @Req() req: Request) {
        try {
            const documento = await this.radicacionService.findOne(id, req.user as any);

            return {
                success: true,
                data: documento,
            };
        } catch (error) {
            const status = error.status || HttpStatus.NOT_FOUND;
            throw new HttpException(
                {
                    success: false,
                    message: error.message || 'Documento no encontrado',
                },
                status,
            );
        }
    }

    @Get(':id/descargar/:numeroDocumento')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS)
    async descargarDocumento(
        @Param('id') id: string,
        @Param('numeroDocumento') numeroDocumento: number,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        try {
            const user = req.user as any;
            this.logger.log(`📥 Usuario ${user.username} descargando documento ${id}, archivo ${numeroDocumento}`);

            const rutaArchivo = await this.radicacionService.obtenerRutaArchivo(
                id,
                numeroDocumento,
                user,
            );

            if (!fs.existsSync(rutaArchivo)) {
                return res.status(HttpStatus.NOT_FOUND).json({
                    success: false,
                    message: 'Archivo no encontrado en el servidor',
                });
            }

            const fileName = path.basename(rutaArchivo);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            const fileStream = fs.createReadStream(rutaArchivo);
            fileStream.pipe(res);

        } catch (error) {
            this.logger.error(`❌ Error descargando documento: ${error.message}`);

            if (!res.headersSent) {
                const status = error.status || HttpStatus.NOT_FOUND;
                return res.status(status).json({
                    success: false,
                    message: error.message || 'Error al descargar archivo',
                });
            }
        }
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.RADICADOR, UserRole.ADMIN)
    @UseInterceptors(FilesInterceptor('documentos', 3))
    async create(
        @UploadedFiles() files: Array<Express.Multer.File>,
        @Body() createDocumentoDto: CreateDocumentoDto,
        @Req() req: Request,
    ) {
        try {
            const user = req.user as any;
            this.logger.log(`📝 ====== INICIANDO RADICACIÓN ======`);
            this.logger.log(`👤 Usuario: ${user.username} (${user.role})`);
            this.logger.log(`📄 DTO recibido:`, JSON.stringify(createDocumentoDto, null, 2));
            this.logger.log(`📁 Archivos recibidos: ${files?.length || 0}`);
            
            if (files) {
                files.forEach((file, index) => {
                    this.logger.log(`   Archivo ${index + 1}: ${file.originalname} (${file.size} bytes)`);
                });
            }

            const documento = await this.radicacionService.create(
                createDocumentoDto,
                files,
                user,
            );

            this.logger.log(`✅ Documento ${createDocumentoDto.numeroRadicado} radicado exitosamente`);
            
            return {
                success: true,
                message: 'Documento radicado exitosamente',
                data: documento,
            };
        } catch (error) {
            this.logger.error(`❌ ERROR EN RADICACIÓN: ${error.message}`);
            this.logger.error(`❌ Stack trace:`, error.stack);
            this.logger.error(`❌ Error completo:`, error);
            
            const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
            throw new HttpException(
                {
                    success: false,
                    message: error.message || 'Error al radicar documento',
                    timestamp: new Date().toISOString(),
                    path: '/api/radicacion'
                },
                status,
            );
        }
    }

    /**
     * Test endpoint para sistema de archivos
     */
    @Get('test/filesystem')
    async testFilesystem() {
        try {
            const testPath = path.join(process.cwd(), 'test-filesystem.txt');
            const content = `Test de sistema de archivos: ${new Date().toISOString()}`;

            // Intentar escribir
            fs.writeFileSync(testPath, content, 'utf8');
            this.logger.log(`✅ Archivo creado: ${testPath}`);

            // Intentar leer
            const readContent = fs.readFileSync(testPath, 'utf8');
            this.logger.log(`✅ Archivo leído: ${readContent.substring(0, 50)}...`);

            // Intentar eliminar
            fs.unlinkSync(testPath);
            this.logger.log(`✅ Archivo eliminado: ${testPath}`);

            return {
                success: true,
                message: 'Sistema de archivos funcionando correctamente',
                testPath,
                content,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`❌ Error en test filesystem: ${error.message}`);
            this.logger.error(`❌ Stack: ${error.stack}`);

            return {
                success: false,
                message: `Error en sistema de archivos: ${error.message}`,
                errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Test endpoint mínimo (sin archivos)
     */
    @Post('test-minimal')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.RADICADOR, UserRole.ADMIN)
    async testMinimal(
        @Body() testData: any,
        @Req() req: Request,
    ) {
        try {
            const user = req.user as any;
            this.logger.log(`🧪 TEST MINIMAL - Usuario: ${user.username}`);
            
            // Intentar crear un documento sin archivos (solo para test)
            const documento = {
                id: 'test-id',
                numeroRadicado: 'R2024-999',
                numeroContrato: 'TEST-001',
                nombreContratista: 'Test Contratista',
                documentoContratista: '999999999',
                fechaInicio: new Date(),
                fechaFin: new Date(),
                estado: 'RADICADO',
                createdAt: new Date()
            };
            
            this.logger.log(`🧪 Documento de prueba creado`);
            
            return {
                success: true,
                message: 'Test minimal funcionando',
                user: user.username,
                documento: documento,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            this.logger.error(`❌ ERROR TEST MINIMAL: ${error.message}`);
            return {
                success: false,
                message: `Error en test: ${error.message}`,
                timestamp: new Date().toISOString()
            };
        }
    }
}