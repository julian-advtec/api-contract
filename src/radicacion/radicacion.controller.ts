import {
  Controller,
  Post,
  Get,
  Put,
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
  UnauthorizedException,
  Delete,
  Patch
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
import { Like, Not } from 'typeorm';
import { PrimerRadicadoInfo } from './interfaces/primer-radicado-info.interface';
import { StorageService } from '../common/storage/storage.service';

@Controller('radicacion')
export class RadicacionController {
  private readonly logger = new Logger(RadicacionController.name);

  constructor(
    private readonly radicacionService: RadicacionService,
    private readonly storageService: StorageService,
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
    UserRole.AUXILIAR_AUDITOR,
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

  @Get('estadisticas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerEstadisticas() {
    try {
      const estadisticas = await this.radicacionService.obtenerEstadisticasGenerales();
      return {
        success: true,
        data: estadisticas
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener estadísticas'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('buscar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.AUDITOR_CUENTAS,
    UserRole.AUXILIAR_AUDITOR
  )
  async buscar(
    @Req() req: Request,
    @Query('numeroRadicado') numeroRadicado?: string,
    @Query('numeroContrato') numeroContrato?: string,
    @Query('documentoContratista') documentoContratista?: string,
    @Query('estado') estado?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string
  ) {
    try {
      const user = req.user as any;

      this.logger.log(`🔍 Usuario ${user.username} realizando búsqueda`);

      const criterios: any = {};
      if (numeroRadicado) criterios.numeroRadicado = numeroRadicado;
      if (numeroContrato) criterios.numeroContrato = numeroContrato;
      if (documentoContratista) criterios.documentoContratista = documentoContratista;
      if (estado) criterios.estado = estado;
      if (fechaDesde) criterios.fechaDesde = new Date(fechaDesde);
      if (fechaHasta) criterios.fechaHasta = new Date(fechaHasta);

      const documentos = await this.radicacionService.buscarDocumentos(criterios, user);

      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error: any) {
      this.logger.error(`❌ Error en búsqueda: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al buscar documentos'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('contratista/:documento')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.AUXILIAR_AUDITOR,
  )
  async obtenerPorContratista(
    @Param('documento') documento: string,
    @Req() req: Request
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`🔍 Buscando documentos del contratista: ${documento}`);

      const documentos = await this.radicacionService.obtenerDocumentosPorContratista(documento, user);

      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo documentos por contratista: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos del contratista'
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('vencidos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR
  )
  async obtenerVencidos(@Req() req: Request) {
    try {
      const user = req.user as any;
      this.logger.log(`⚠️ Usuario ${user.username} solicitando documentos vencidos`);

      const documentos = await this.radicacionService.obtenerDocumentosVencidos(user);

      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo documentos vencidos: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos vencidos'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUXILIAR_AUDITOR)
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

      // ✅ VALIDACIÓN DEL FORMATO DE RADICADO - CORREGIDA
      const radicadoRegex = /^R\d{4}-\d{4,8}$/;  // ✅ AHORA PERMITE 4-8 DÍGITOS
      if (!radicadoRegex.test(createDocumentoDto.numeroRadicado)) {
        throw new BadRequestException(
          'Formato de radicado inválido. Debe ser RAAAA-NNNN (ej: R2025-0001) donde NNNN puede ser de 4 a 8 dígitos'
        );
      }

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

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async actualizarDocumento(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`✏️ Usuario ${user.username} actualizando documento ${id}`);

      const documento = await this.radicacionService.actualizarDocumentoConFlujo(id, body, user);

      return {
        success: true,
        message: 'Documento actualizado exitosamente',
        data: documento
      };
    } catch (error: any) {
      this.logger.error(`❌ Error actualizando documento: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al actualizar documento'
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Put(':id/cambiar-estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.AUDITOR_CUENTAS
  )
  async cambiarEstado(
    @Param('id') id: string,
    @Body() body: { estado: string; observacion?: string },
    @Req() req: Request
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`🔄 Usuario ${user.username} cambiando estado del documento ${id} a ${body.estado}`);

      const documento = await this.radicacionService.cambiarEstadoDocumento(
        id,
        body.estado,
        user.id,
        body.observacion
      );

      return {
        success: true,
        message: 'Estado del documento actualizado exitosamente',
        data: documento
      };
    } catch (error: any) {
      this.logger.error(`❌ Error cambiando estado: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al cambiar estado del documento'
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Patch(':id/campos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.RADICADOR,
    UserRole.ADMIN,
    UserRole.SUPERVISOR
  )
  async actualizarCampos(
    @Param('id') id: string,
    @Body() body: {
      estado?: string;
      comentarios?: string;
      correcciones?: string;
      usuarioAsignadoId?: string;
      fechaLimiteRevision?: Date;
    },
    @Req() req: Request
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`✏️ Usuario ${user.username} actualizando campos del documento ${id}`);

      const documento = await this.radicacionService.actualizarCampos(id, body, user);

      return {
        success: true,
        message: 'Campos del documento actualizados exitosamente',
        data: documento
      };
    } catch (error: any) {
      this.logger.error(`❌ Error actualizando campos: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al actualizar campos del documento'
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // GESTIÓN DE ARCHIVOS
  // ===============================
  @Get(':id/descargar/:numeroDocumento')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS, UserRole.AUXILIAR_AUDITOR)
  async descargarDocumento(
    @Param('id') id: string,
    @Param('numeroDocumento') numeroDocumento: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`📥 Descarga solicitada: documento ${id}, archivo ${numeroDocumento}`);

      // Obtenemos la ruta RELATIVA
      const relativePath = await this.radicacionService.obtenerRutaArchivo(
        id,
        +numeroDocumento,
        user
      );

      // ✅ Usamos StorageService para obtener el stream
      const fileBuffer = await this.storageService.getFile(relativePath);

      const fileName = path.basename(relativePath);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Length', fileBuffer.length);

      res.end(fileBuffer);   // Más simple y confiable que stream en muchos casos

    } catch (error: any) {
      this.logger.error(`❌ Error en descarga: ${error.message}`);

      if (!res.headersSent) {
        const status = error.status || HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'No se pudo descargar el archivo'
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
    try {
      if (!token) throw new UnauthorizedException('Token requerido');

      const doc = await this.radicacionService.findOnePublico(id, token);
      if (!doc) throw new NotFoundException('Documento no encontrado');

      const nombres = [doc.cuentaCobro, doc.seguridadSocial, doc.informeActividades];
      const relativePath = nombres[index - 1];

      if (!relativePath) throw new NotFoundException('Archivo no registrado');

      // Verificar existencia
      if (!(await this.storageService.fileExists(relativePath))) {
        throw new NotFoundException('Archivo no encontrado en el servidor');
      }

      const buffer = await this.storageService.getFile(relativePath);
      const ext = path.extname(relativePath).toLowerCase();
      const fileName = path.basename(relativePath);

      const mime: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');

      if (download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      // Para Word → convertir a PDF si no se pide descarga (opcional, puedes quitarlo si molesta)
      if ((ext === '.doc' || ext === '.docx') && download !== 'true') {
        // Aquí mantienes tu lógica de conversión si la necesitas
        // Por ahora lo enviamos tal cual
      }

      res.end(buffer);

    } catch (error: any) {
      this.logger.error(`❌ Error previsualizando archivo: ${error.message}`);
      if (!res.headersSent) {
        res.status(error.status || 404).json({
          success: false,
          message: error.message
        });
      }
    }
  }

  // ===============================
  // ✅ NUEVO ENDPOINT: Primeros radicados por año
  // ===============================

  @Get('estadisticas/primer-radicado-ano')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.RADICADOR)
  async obtenerPrimerosRadicadosPorAno(@Query('ano') ano?: string) {
    try {
      this.logger.log(`📊 Consultando primeros radicados por año`);

      const query = this.radicacionService['documentoRepository']
        .createQueryBuilder('documento')
        .where('documento.primer_radicado_ano = :esPrimer', { esPrimer: true })
        .orderBy('documento.numeroRadicado', 'ASC');

      if (ano) {
        query.andWhere('documento.numeroRadicado LIKE :ano', { ano: `R${ano}-%` });
      }

      const primerosRadicados = await query.getMany();

      // ✅ USANDO LA INTERFAZ
      const agrupadosPorAno = primerosRadicados.reduce((acc: Record<string, PrimerRadicadoInfo[]>, documento) => {
        const ano = documento.numeroRadicado.substring(1, 5);
        if (!acc[ano]) {
          acc[ano] = [];
        }
        acc[ano].push({
          id: documento.id,
          numeroRadicado: documento.numeroRadicado,
          nombreContratista: documento.nombreContratista,
          fechaRadicacion: documento.fechaRadicacion,
          radicador: documento.nombreRadicador,
          primerRadicadoDelAno: documento.primerRadicadoDelAno
        });
        return acc;
      }, {} as Record<string, PrimerRadicadoInfo[]>);

      return {
        success: true,
        data: {
          total: primerosRadicados.length,
          porAno: agrupadosPorAno,
          detalles: primerosRadicados.map(doc => ({
            id: doc.id,
            numeroRadicado: doc.numeroRadicado,
            ano: doc.numeroRadicado.substring(1, 5),
            primerRadicadoDelAno: doc.primerRadicadoDelAno,
            contratista: doc.nombreContratista,
            fecha: doc.fechaRadicacion,
            radicador: doc.nombreRadicador
          }))
        }
      };

    } catch (error) {
      this.logger.error(`❌ Error obteniendo primeros radicados: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener estadísticas'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // ✅ NUEVO ENDPOINT: Verificar primer radicado disponible
  // ===============================

  @Get('verificar-primer-radicado/:ano')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.RADICADOR)
  async verificarPrimerRadicadoDisponible(@Param('ano') ano: string) {
    try {
      this.logger.log(`🔍 Verificando primer radicado disponible para el año ${ano}`);

      // Verificar si ya existe un primer radicado para este año
      const existePrimerRadicado = await this.radicacionService['documentoRepository']
        .findOne({
          where: {
            primerRadicadoDelAno: true,
            numeroRadicado: Like(`R${ano}-%`)
          }
        });

      const disponible = !existePrimerRadicado;

      return {
        success: true,
        data: {
          ano,
          disponible,
          primerRadicadoExistente: existePrimerRadicado ? {
            numeroRadicado: existePrimerRadicado.numeroRadicado,
            fechaRadicacion: existePrimerRadicado.fechaRadicacion,
            radicador: existePrimerRadicado.nombreRadicador,
            contratista: existePrimerRadicado.nombreContratista
          } : null,
          mensaje: disponible ?
            `✅ Disponible: Puede marcar un documento como primer radicado del año ${ano}` :
            `⚠️ Ya existe: El año ${ano} ya tiene un primer radicado registrado`
        }
      };

    } catch (error) {
      this.logger.error(`❌ Error verificando primer radicado: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al verificar primer radicado'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // ✅ NUEVO ENDPOINT: Actualizar primer radicado manualmente
  // ===============================

  @Put(':id/marcar-primer-radicado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.RADICADOR)
  async marcarComoPrimerRadicado(
    @Param('id') id: string,
    @Body() body: { esPrimerRadicado: boolean },
    @Req() req: Request
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`🏷️ Usuario ${user.username} marcando documento ${id} como primer radicado: ${body.esPrimerRadicado}`);

      const documento = await this.radicacionService['documentoRepository'].findOne({
        where: { id }
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      // Extraer año del documento
      const ano = documento.numeroRadicado.substring(1, 5);

      if (body.esPrimerRadicado) {
        // Verificar si ya existe un primer radicado para este año
        const primerRadicadoExistente = await this.radicacionService['documentoRepository'].findOne({
          where: {
            id: Not(id), // Excluir el documento actual
            primerRadicadoDelAno: true,
            numeroRadicado: Like(`R${ano}-%`)
          }
        });

        if (primerRadicadoExistente) {
          throw new BadRequestException(`Ya existe un primer radicado para el año ${ano}: ${primerRadicadoExistente.numeroRadicado}`);
        }
      }

      // Actualizar el campo
      documento.primerRadicadoDelAno = body.esPrimerRadicado;
      documento.fechaActualizacion = new Date();
      documento.ultimoUsuario = user.username;

      const documentoActualizado = await this.radicacionService['documentoRepository'].save(documento);

      // Agregar al historial
      const historial = documentoActualizado.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: documentoActualizado.estado,
        usuarioId: user.id,
        usuarioNombre: user.username,
        rolUsuario: user.role,
        observacion: body.esPrimerRadicado ?
          `Marcado como primer radicado del año ${ano}` :
          `Desmarcado como primer radicado del año ${ano}`
      });
      documentoActualizado.historialEstados = historial;

      await this.radicacionService['documentoRepository'].save(documentoActualizado);

      return {
        success: true,
        message: body.esPrimerRadicado ?
          `✅ Documento marcado como primer radicado del año ${ano}` :
          `✅ Documento desmarcado como primer radicado del año ${ano}`,
        data: {
          id: documentoActualizado.id,
          numeroRadicado: documentoActualizado.numeroRadicado,
          primerRadicadoDelAno: documentoActualizado.primerRadicadoDelAno,
          ano,
          fechaActualizacion: documentoActualizado.fechaActualizacion
        }
      };

    } catch (error) {
      this.logger.error(`❌ Error marcando primer radicado: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al marcar como primer radicado'
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // ✅ ENDPOINT: Obtener conteo de documentos radicados
  // ===============================

  @Get('conteo/radicados')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerConteoRadicados() {
    try {
      this.logger.log(`📊 Obteniendo conteo de documentos radicados`);

      const conteo = await this.radicacionService.obtenerConteoDocumentosRadicados();

      return {
        success: true,
        data: {
          conteo,
          fecha: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo conteo: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener conteo de documentos'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('documento/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)

  async obtenerDocumentoPorId(@Param('id') id: string, @Req() req: Request) {
    try {
      const user = req.user as any;
      this.logger.log(`🔍 Usuario ${user.username} solicitando documento ${id} por ID`);

      const documento = await this.radicacionService.obtenerDocumentoPorId(id);

      if (!documento) {
        throw new NotFoundException(`Documento con ID ${id} no encontrado`);
      }

      return {
        success: true,
        data: documento
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo documento: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Documento no encontrado'
        },
        error.status || HttpStatus.NOT_FOUND
      );
    }
  }
}
