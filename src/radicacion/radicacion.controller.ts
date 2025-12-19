// src/radicacion/radicacion.controller.ts
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
  BadRequestException,
  Query,
  NotFoundException,
  UnauthorizedException
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
import * as os from 'os';
import * as crypto from 'crypto';

@Controller('radicacion')
export class RadicacionController {
  private readonly logger = new Logger(RadicacionController.name);

  constructor(
    private readonly radicacionService: RadicacionService,
  ) { }

  // ===============================
  // ENDPOINTS DE HEALTH & TEST
  // ===============================

  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'radicacion',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('test')
  async testEndpoint() {
    return {
      success: true,
      message: 'Radicación API está funcionando',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('test/filesystem')
  async testFilesystem() {
    try {
      const testPath = path.join(process.cwd(), 'test-filesystem.txt');
      const content = `Test de sistema de archivos: ${new Date().toISOString()}`;

      fs.writeFileSync(testPath, content, 'utf8');
      this.logger.log(`✅ Archivo creado: ${testPath}`);

      const readContent = fs.readFileSync(testPath, 'utf8');
      this.logger.log(`✅ Archivo leído: ${readContent.substring(0, 50)}...`);

      fs.unlinkSync(testPath);
      this.logger.log(`✅ Archivo eliminado: ${testPath}`);

      return {
        success: true,
        message: 'Sistema de archivos funcionando correctamente',
        testPath,
        content,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
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

  @Get('test/server-access')
  async testServerAccess() {
    try {
      this.logger.log(`🔍 Test de acceso al servidor R2-D2`);

      // Probar diferentes formatos de ruta
      const testPath = this.radicacionService['basePath'];

      return {
        success: true,
        message: 'Acceso al servidor configurado',
        serverPath: testPath,
        exists: fs.existsSync(testPath),
        canWrite: true,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      this.logger.error(`❌ Error test servidor: ${error.message}`);
      return {
        success: false,
        message: `Error accediendo al servidor: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ===============================
  // DEBUG & PERMISOS
  // ===============================

  @Get('debug/user-info')
  @UseGuards(JwtAuthGuard)
  async debugUserInfo(@Req() req: Request) {
    const user = req.user as any;

    this.logger.log(`🔍 Debug info solicitada por usuario: ${user.username} (${user.role})`);

    // NORMALIZAR A MINÚSCULA
    const userRole = user.role?.toString().toLowerCase();

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          fullName: user.fullName,
          normalizedRole: userRole
        },
        permissions: {
          canRadicar: [UserRole.RADICADOR, UserRole.ADMIN].includes(userRole as UserRole),
          canView: [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS].includes(userRole as UserRole)
        },
        timestamp: new Date().toISOString(),
      }
    };
  }

  @Get('verificar/permisos')
  @UseGuards(JwtAuthGuard)
  async verificarPermisos(@Req() req: Request) {
    const user = req.user as any;

    this.logger.log(`🔐 Verificando permisos para usuario: ${user.username} (${user.role})`);

    // NORMALIZAR A MINÚSCULA (igual que el enum)
    const userRole = user.role?.toString().toLowerCase();

    // Usar las constantes directamente (ya están en minúscula)
    const puedeRadicar = [UserRole.RADICADOR, UserRole.ADMIN].includes(userRole as UserRole);

    const puedeVer = [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS]
      .includes(userRole as UserRole);

    const puedeDescargar = [UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS]
      .includes(userRole as UserRole);

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

  // ===============================
  // MIS DOCUMENTOS (DOCUMENTOS DEL USUARIO ACTUAL)
  // ===============================

  @Get('mis-documentos')
  @UseGuards(JwtAuthGuard)
  async getMisDocumentos(@Req() req: Request) {
    try {
      const user = req.user as any;

      this.logger.log(
        `📋 Usuario ${user.username} solicitando sus documentos`
      );

      const documentos = await this.radicacionService.getMisDocumentos(user);

      return {
        success: true,
        count: documentos.length,
        data: documentos,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(
        '❌ Error obteniendo mis documentos:',
        error.message,
      );

      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al obtener documentos',
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  // ===============================
  // CRUD PRINCIPAL
  // ===============================

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.AUDITOR_CUENTAS,
    UserRole.CONTABILIDAD,
    UserRole.TESORERIA,
    UserRole.ASESOR_GERENCIA,
    UserRole.RENDICION_CUENTAS
  )
  async findAll(@Req() req: Request) {
    const user = req.user as any;

    this.logger.log(
      `📋 Usuario ${user.username} (${user.role}) listando radicaciones`
    );

    const documentos = await this.radicacionService.findAll(user);

    return {
      success: true,
      count: documentos.length,
      data: documentos,
    };
  }



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
    } catch (error: any) {
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

      // 1. VERIFICAR PERMISOS
      const userRole = user.role?.toString().toLowerCase();
      const rolesPermitidos = [UserRole.ADMIN, UserRole.RADICADOR].map(r => r.toString().toLowerCase());

      if (!rolesPermitidos.includes(userRole)) {
        this.logger.error(`🚫 USUARIO SIN PERMISOS`);
        throw new HttpException(
          {
            success: false,
            message: `No tienes permisos para radicar documentos. Tu rol es: ${user.role}. Solo pueden radicar: ${UserRole.ADMIN} y ${UserRole.RADICADOR}.`,
          },
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`📄 DTO recibido:`, JSON.stringify(createDocumentoDto, null, 2));
      this.logger.log(`📁 Archivos recibidos: ${files?.length || 0}`);

      // 2. VALIDACIÓN BÁSICA
      if (!files || files.length !== 3) {
        throw new BadRequestException('Debe adjuntar exactamente 3 documentos');
      }

      // 3. CREAR DOCUMENTO
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
    } catch (error: any) {
      this.logger.error(`❌ ERROR EN RADICACIÓN: ${error.message}`);
      this.logger.error(`❌ Stack trace:`, error.stack);

      const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al radicar documento',
          timestamp: new Date().toISOString(),
        },
        status,
      );
    }
  }

  // ===============================
  // GESTIÓN DE ARCHIVOS
  // ===============================

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

    } catch (error: any) {
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

  @Get(':id/archivo/:index')
  async archivoPublico(
    @Param('id') id: string,
    @Param('index') index: number,
    @Query('token') token: string,
    @Query('download') download: string,
    @Res() res: Response
  ) {
    if (!token) throw new UnauthorizedException('Token requerido');

    const doc = await this.radicacionService.findOnePublico(id, token);
    if (!doc) throw new NotFoundException('Documento no encontrado o token inválido');

    // ACTUALIZADO: Usar los nuevos nombres de variables
    const nombres = [
      doc.cuentaCobro,
      doc.seguridadSocial,
      doc.informeActividades
    ];

    const nombreArchivo = nombres[index - 1];
    if (!nombreArchivo) throw new NotFoundException('Archivo no registrado');

    const filePath = path.join(doc.rutaCarpetaRadicado, nombreArchivo);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Archivo no encontrado en el servidor');
    }

    const ext = path.extname(filePath).toLowerCase();

    this.logger.log(`📄 Enviando archivo: ${filePath}`);

    // CASO WORD + NO DOWNLOAD → CONVERTIR A PDF
    if ((ext === '.doc' || ext === '.docx') && download !== 'true') {
      const tmpPdf = path.join(
        os.tmpdir(),
        `${crypto.randomUUID()}.pdf`
      );

      await this.radicacionService.convertirWordAPdf(filePath, tmpPdf);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');

      const stream = fs.createReadStream(tmpPdf);
      stream.pipe(res);

      res.on('finish', () => {
        fs.unlink(tmpPdf, () => { });
      });

      return;
    }

    // RESTO DE ARCHIVOS
    const mime: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      download === 'true'
        ? `attachment; filename="${nombreArchivo}"`
        : 'inline'
    );

    return fs.createReadStream(filePath).pipe(res);
  }
}