// src/contratista/contratista.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ContratistaService } from './contratista.service';
import { TipoDocumento } from './entities/documento-contratista.entity';
import { Contratista } from './entities/contratista.entity';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity';

@Controller('contratistas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContratistasController {
  private readonly logger = new Logger(ContratistasController.name);

  constructor(
    private readonly contratistaService: ContratistaService,
    private readonly bitacoraService: BitacoraSistemaService,
  ) { }

  // ===============================
  // HEALTH CHECK
  // ===============================

  @Get('health')
  async healthCheck() {
    return {
      ok: true,
      status: 'ok',
      service: 'contratistas',
      timestamp: new Date().toISOString(),
    };
  }

  // ===============================
  // CRUD PRINCIPAL
  // ===============================

  @Get()
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.JURIDICA)
  async obtenerTodos(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: any,
  ) {
    const inicio = Date.now();
    try {
      this.logger.log('📋 Obteniendo todos los contratistas');

      const contratistas = await this.contratistaService.obtenerTodos({
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });

      const datosFormateados = contratistas.map(c => ({
        id: c.id,
        tipoDocumento: c.tipoDocumento,
        documentoIdentidad: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        nombreCompleto: c.razonSocial,
        representanteLegal: c.representanteLegal,
        documentoRepresentante: c.documentoRepresentante,
        telefono: c.telefono,
        email: c.email,
        direccion: c.direccion,
        departamento: c.departamento,
        ciudad: c.ciudad,
        tipoContratista: c.tipoContratista,
        estado: c.estado,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        cargo: c.cargo,
        objetivoContrato: c.objetivoContrato,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }));

      try {
        await this.bitacoraService.registrar(
          AccionBitacora.VER_DOCUMENTO,
          ModuloBitacora.ADMINISTRACION,
          req.user,
          undefined,
          {
            detalles: `Consulta lista de contratistas (${datosFormateados.length} registros)`,
            duracionMs: Date.now() - inicio,
          },
          req,
        );
      } catch (bitacoraError) {
        this.logger.warn(`⚠️ Error en bitácora (no crítico): ${bitacoraError.message}`);
      }

      return {
        ok: true,
        data: datosFormateados,
        total: datosFormateados.length
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratistas: ${error.message}`);
      return {
        ok: false,
        message: 'Error al obtener contratistas',
        data: [],
        total: 0
      };
    }
  }

  @Get('buscar')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async buscar(@Query('termino') termino: string, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Buscando contratistas por término: "${termino}"`);

      const contratistas = await this.contratistaService.buscarPorTermino(termino);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Búsqueda de contratistas por término: "${termino}" - ${contratistas.length} resultados`,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          count: contratistas.length,
          data: contratistas,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contratistas: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al buscar contratistas',
          data: []
        }
      };
    }
  }

  @Get('buscar/combinado')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async buscarCombinado(
    @Query('tipo') tipo: 'nombre' | 'documento' | 'contrato',
    @Query('termino') termino: string,
    @Req() req?: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Búsqueda combinada: ${tipo} - "${termino}"`);

      if (!tipo || !termino) {
        return {
          ok: true,
          data: {
            success: false,
            message: 'Tipo y término de búsqueda son requeridos',
            data: []
          }
        };
      }

      const contratistas = await this.contratistaService.buscarCombinado(tipo, termino);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        documentoIdentidad: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        email: c.email,
        telefono: c.telefono,
        cargo: c.cargo,
        createdAt: c.createdAt
      }));

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Búsqueda combinada: ${tipo}=${termino} - ${resultados.length} resultados`,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          count: resultados.length,
          data: resultados,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en búsqueda combinada: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al realizar la búsqueda',
          data: []
        }
      };
    }
  }

  @Get('buscar/avanzado')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async buscarAvanzado(
    @Query('nombre') nombre?: string,
    @Query('documento') documento?: string,
    @Query('contrato') contrato?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log('🔍 Búsqueda avanzada solicitada');

      const filtros: any = {};
      if (nombre) filtros.nombre = nombre;
      if (documento) filtros.documento = documento;
      if (contrato) filtros.contrato = contrato;
      if (fechaDesde) filtros.fechaDesde = new Date(fechaDesde);
      if (fechaHasta) filtros.fechaHasta = new Date(fechaHasta);
      if (limit) filtros.limit = parseInt(limit);
      if (offset) filtros.offset = parseInt(offset);

      const resultado = await this.contratistaService.buscarAvanzado(filtros);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Búsqueda avanzada - ${resultado.contratistas.length} de ${resultado.total} resultados`,
          duracionMs: Date.now() - inicio,
          metadata: filtros
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          count: resultado.contratistas.length,
          total: resultado.total,
          data: resultado.contratistas
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en búsqueda avanzada: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error en búsqueda avanzada',
          data: []
        }
      };
    }
  }

  @Get(':id')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.JURIDICA)
  async obtenerPorId(@Param('id') id: string, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Obteniendo contratista por ID: ${id}`);

      const contratista = await this.contratistaService.buscarPorId(id);

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Visualización de contratista: ${contratista.razonSocial} (${contratista.documentoIdentidad})`,
          contratistaId: contratista.id,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          data: contratista,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratista: ${error.message}`);

      if (error instanceof NotFoundException) {
        return {
          ok: true,
          data: {
            success: false,
            message: `Contratista con ID ${id} no encontrado`,
            data: null
          }
        };
      }

      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al obtener contratista',
          data: null
        }
      };
    }
  }

  @Get(':id/completo')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerContratistaCompleto(@Param('id') id: string, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Obteniendo contratista completo: ${id}`);

      const contratistaCompleto = await this.contratistaService.obtenerContratistaCompleto(id);

      if (!contratistaCompleto) {
        return {
          ok: true,
          data: {
            success: false,
            message: 'Contratista no encontrado',
            data: null
          }
        };
      }

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Visualización completa de contratista: ${contratistaCompleto.razonSocial}`,
          contratistaId: id,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          data: contratistaCompleto
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratista completo: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  @Get('documento/:documento')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerPorDocumento(@Param('documento') documento: string, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Obteniendo contratista por documento: ${documento}`);

      if (!documento || documento.trim().length < 1) {
        return {
          ok: true,
          data: {
            success: true,
            count: 0,
            data: [],
          }
        };
      }

      const contratistas = await this.contratistaService.buscarPorDocumento(documento);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        documentoIdentidad: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        email: c.email,
        telefono: c.telefono,
        cargo: c.cargo,
        createdAt: c.createdAt
      }));

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Búsqueda por documento: ${documento} - ${resultados.length} resultados`,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          count: resultados.length,
          data: resultados,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo por documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al buscar por documento',
          data: []
        }
      };
    }
  }

  // ===============================
  // CREAR CONTRATISTA
  // ===============================

  @Post()
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async crear(@Body() body: {
    tipoDocumento: string;
    documentoIdentidad: string;
    razonSocial: string;
    representanteLegal?: string;
    documentoRepresentante?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
    departamento?: string;
    ciudad?: string;
    tipoContratista?: string;
    estado?: string;
    numeroContrato?: string;
    cargo?: string;
    objetivoContrato?: string;
  }, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log('📝 Creando nuevo contratista');
      this.logger.log('📥 Datos recibidos:', JSON.stringify(body, null, 2));

      if (!body.documentoIdentidad || !body.razonSocial) {
        throw new BadRequestException('Documento de identidad y razón social son requeridos');
      }

      const contratistaData = {
        tipoDocumento: body.tipoDocumento || 'CC',
        documentoIdentidad: body.documentoIdentidad,
        razonSocial: body.razonSocial,
        representanteLegal: body.representanteLegal !== undefined ? body.representanteLegal : undefined,
        documentoRepresentante: body.documentoRepresentante !== undefined ? body.documentoRepresentante : undefined,
        telefono: body.telefono !== undefined ? body.telefono : undefined,
        email: body.email !== undefined ? body.email : undefined,
        direccion: body.direccion !== undefined ? body.direccion : undefined,
        departamento: body.departamento !== undefined ? body.departamento : undefined,
        ciudad: body.ciudad !== undefined ? body.ciudad : undefined,
        tipoContratista: body.tipoContratista !== undefined ? body.tipoContratista : undefined,
        estado: body.estado || 'ACTIVO',
        numeroContrato: body.numeroContrato !== undefined ? body.numeroContrato : undefined,
        cargo: body.cargo !== undefined ? body.cargo : undefined,
        objetivoContrato: body.objetivoContrato !== undefined ? body.objetivoContrato : undefined
      };

      this.logger.log('📦 Datos mapeados:', JSON.stringify(contratistaData, null, 2));

      const contratista = await this.contratistaService.crear(contratistaData);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_CREAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Contratista creado: ${contratista.razonSocial} (${contratista.documentoIdentidad})`,
          contratistaId: contratista.id,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Contratista creado exitosamente',
          data: contratista,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error creando contratista: ${error.message}`);

      if (error instanceof BadRequestException || error instanceof ConflictException) {
        return {
          ok: true,
          data: {
            success: false,
            message: error.message,
            data: null
          }
        };
      }

      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al crear contratista',
          data: null
        }
      };
    }
  }

  @Post('completo')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('documentos', 20))
  async crearContratistaCompleto(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log('📝 Creando contratista con documentos');
      this.logger.log('📥 Body recibido:', JSON.stringify(body, null, 2));

      const datosContratista = {
        tipoDocumento: body.tipoDocumento || 'CC',
        documentoIdentidad: body.documentoIdentidad,
        razonSocial: body.razonSocial,
        representanteLegal: body.representanteLegal !== undefined ? body.representanteLegal : undefined,
        documentoRepresentante: body.documentoRepresentante !== undefined ? body.documentoRepresentante : undefined,
        telefono: body.telefono !== undefined ? body.telefono : undefined,
        email: body.email !== undefined ? body.email : undefined,
        direccion: body.direccion !== undefined ? body.direccion : undefined,
        departamento: body.departamento !== undefined ? body.departamento : undefined,
        ciudad: body.ciudad !== undefined ? body.ciudad : undefined,
        tipoContratista: body.tipoContratista !== undefined ? body.tipoContratista : undefined,
        estado: body.estado || 'ACTIVO',
        numeroContrato: body.numeroContrato !== undefined ? body.numeroContrato : undefined,
        cargo: body.cargo !== undefined ? body.cargo : undefined,
        objetivoContrato: body.objetivoContrato !== undefined ? body.objetivoContrato : undefined
      };

      this.logger.log('📦 Datos del contratista:', JSON.stringify(datosContratista, null, 2));

      if (!datosContratista.documentoIdentidad || !datosContratista.razonSocial) {
        throw new BadRequestException('Documento y razón social son requeridos');
      }

      const documentos = [];
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const tipo = body[`tipo_documento_${i}`];
          if (tipo && Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
            documentos.push({
              tipo: tipo as TipoDocumento,
              archivo: files[i]
            });
          }
        }
      }

      const resultado = await this.contratistaService.crearConDocumentos(
        datosContratista,
        documentos,
        req.user?.email || 'sistema'
      );

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_CREAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Contratista creado con ${documentos.length} documentos: ${resultado.contratista.razonSocial}`,
          contratistaId: resultado.contratista.id,
          duracionMs: Date.now() - inicio,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Contratista creado exitosamente',
          data: resultado
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error creando contratista completo: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  // ===============================
  // ACTUALIZAR CONTRATISTA (SIMPLE)
  // ===============================

  @Put(':id')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async actualizar(
    @Param('id') id: string,
    @Body() body: Partial<{
      tipoDocumento: string;
      documentoIdentidad: string;
      razonSocial: string;
      representanteLegal?: string;
      documentoRepresentante?: string;
      telefono?: string;
      email?: string;
      direccion?: string;
      departamento?: string;
      ciudad?: string;
      tipoContratista?: string;
      estado?: string;
      numeroContrato?: string;
      cargo?: string;
      objetivoContrato?: string;
    }>,
    @Req() req?: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`✏️ Actualizando contratista: ${id}`);
      this.logger.log('📥 Datos recibidos:', JSON.stringify(body, null, 2));

      const original = await this.contratistaService.buscarPorId(id);

      const updateData: any = {};
      if (body.tipoDocumento !== undefined) updateData.tipoDocumento = body.tipoDocumento;
      if (body.documentoIdentidad !== undefined) updateData.documentoIdentidad = body.documentoIdentidad;
      if (body.razonSocial !== undefined) updateData.razonSocial = body.razonSocial;
      if (body.representanteLegal !== undefined) updateData.representanteLegal = body.representanteLegal;
      if (body.documentoRepresentante !== undefined) updateData.documentoRepresentante = body.documentoRepresentante;
      if (body.telefono !== undefined) updateData.telefono = body.telefono;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.direccion !== undefined) updateData.direccion = body.direccion;
      if (body.departamento !== undefined) updateData.departamento = body.departamento;
      if (body.ciudad !== undefined) updateData.ciudad = body.ciudad;
      if (body.tipoContratista !== undefined) updateData.tipoContratista = body.tipoContratista;
      if (body.estado !== undefined) updateData.estado = body.estado;
      if (body.numeroContrato !== undefined) updateData.numeroContrato = body.numeroContrato;
      if (body.cargo !== undefined) updateData.cargo = body.cargo;
      if (body.objetivoContrato !== undefined) updateData.objetivoContrato = body.objetivoContrato;

      this.logger.log('📦 Datos mapeados para actualizar:', JSON.stringify(updateData, null, 2));

      const contratista = await this.contratistaService.actualizar(id, updateData);

      const cambios: Record<string, any> = {};
      if (original.razonSocial !== contratista.razonSocial) cambios.razonSocial = { anterior: original.razonSocial, nuevo: contratista.razonSocial };
      if (original.documentoIdentidad !== contratista.documentoIdentidad) cambios.documentoIdentidad = { anterior: original.documentoIdentidad, nuevo: contratista.documentoIdentidad };
      if (original.numeroContrato !== contratista.numeroContrato) cambios.numeroContrato = { anterior: original.numeroContrato, nuevo: contratista.numeroContrato };
      if (original.estado !== contratista.estado) cambios.estado = { anterior: original.estado, nuevo: contratista.estado };
      if (original.email !== contratista.email) cambios.email = { anterior: original.email, nuevo: contratista.email };
      if (original.telefono !== contratista.telefono) cambios.telefono = { anterior: original.telefono, nuevo: contratista.telefono };
      if (original.cargo !== contratista.cargo) cambios.cargo = { anterior: original.cargo, nuevo: contratista.cargo };
      if (original.tipoDocumento !== contratista.tipoDocumento) cambios.tipoDocumento = { anterior: original.tipoDocumento, nuevo: contratista.tipoDocumento };
      if (original.representanteLegal !== contratista.representanteLegal) cambios.representanteLegal = { anterior: original.representanteLegal, nuevo: contratista.representanteLegal };
      if (original.direccion !== contratista.direccion) cambios.direccion = { anterior: original.direccion, nuevo: contratista.direccion };
      if (original.tipoContratista !== contratista.tipoContratista) cambios.tipoContratista = { anterior: original.tipoContratista, nuevo: contratista.tipoContratista };
      if (original.departamento !== contratista.departamento) cambios.departamento = { anterior: original.departamento, nuevo: contratista.departamento };
      if (original.ciudad !== contratista.ciudad) cambios.ciudad = { anterior: original.ciudad, nuevo: contratista.ciudad };
      if (original.objetivoContrato !== contratista.objetivoContrato) cambios.objetivoContrato = { anterior: original.objetivoContrato, nuevo: contratista.objetivoContrato };

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Contratista actualizado: ${contratista.razonSocial}`,
          contratistaId: contratista.id,
          duracionMs: Date.now() - inicio,
          cambios: Object.keys(cambios).length > 0 ? cambios : undefined
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Contratista actualizado exitosamente',
          data: contratista,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error actualizando contratista: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // ACTUALIZAR CONTRATISTA COMPLETO (CON DOCUMENTOS - CREA NUEVA VERSIÓN)
  // ===============================

  @Put(':id/completo')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('documentos', 20))
  async actualizarContratistaCompleto(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`✏️ Actualizando contratista completo (nueva versión): ${id}`);
      this.logger.log('📥 Body recibido:', JSON.stringify(body, null, 2));
      this.logger.log(`📎 Archivos recibidos: ${files?.length || 0}`);

      // Obtener el contratista original para la bitácora
      const original = await this.contratistaService.buscarPorId(id);

      // Preparar datos para actualizar (solo los campos que vienen en el body)
      const datosActualizar: any = {};

      if (body.tipoDocumento !== undefined) datosActualizar.tipoDocumento = body.tipoDocumento;
      if (body.documentoIdentidad !== undefined) datosActualizar.documentoIdentidad = body.documentoIdentidad;
      if (body.razonSocial !== undefined) datosActualizar.razonSocial = body.razonSocial;
      if (body.representanteLegal !== undefined) datosActualizar.representanteLegal = body.representanteLegal;
      if (body.documentoRepresentante !== undefined) datosActualizar.documentoRepresentante = body.documentoRepresentante;
      if (body.telefono !== undefined) datosActualizar.telefono = body.telefono;
      if (body.email !== undefined) datosActualizar.email = body.email;
      if (body.direccion !== undefined) datosActualizar.direccion = body.direccion;
      if (body.departamento !== undefined) datosActualizar.departamento = body.departamento;
      if (body.ciudad !== undefined) datosActualizar.ciudad = body.ciudad;
      if (body.tipoContratista !== undefined) datosActualizar.tipoContratista = body.tipoContratista;
      if (body.estado !== undefined) datosActualizar.estado = body.estado;
      if (body.numeroContrato !== undefined) datosActualizar.numeroContrato = body.numeroContrato;
      if (body.cargo !== undefined) datosActualizar.cargo = body.cargo;
      if (body.objetivoContrato !== undefined) datosActualizar.objetivoContrato = body.objetivoContrato;

      this.logger.log('📦 Datos a actualizar:', JSON.stringify(datosActualizar, null, 2));

      // Procesar documentos nuevos
      const documentos = [];
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const tipo = body[`tipo_documento_${i}`];
          if (tipo && Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
            documentos.push({ tipo: tipo as TipoDocumento, archivo: files[i] });
          }
        }
      }

      // Actualizar contratista - crea nueva versión
      const resultado = await this.contratistaService.actualizarConDocumentos(
        id,
        datosActualizar,
        documentos,
        req.user?.email || 'sistema'
      );

      // Detectar cambios para la bitácora
      const cambios: Record<string, any> = {};
      if (original.razonSocial !== resultado.contratistaNuevo.razonSocial) {
        cambios.razonSocial = { anterior: original.razonSocial, nuevo: resultado.contratistaNuevo.razonSocial };
      }
      if (original.representanteLegal !== resultado.contratistaNuevo.representanteLegal) {
        cambios.representanteLegal = { anterior: original.representanteLegal, nuevo: resultado.contratistaNuevo.representanteLegal };
      }
      if (original.tipoContratista !== resultado.contratistaNuevo.tipoContratista) {
        cambios.tipoContratista = { anterior: original.tipoContratista, nuevo: resultado.contratistaNuevo.tipoContratista };
      }
      if (original.cargo !== resultado.contratistaNuevo.cargo) {
        cambios.cargo = { anterior: original.cargo, nuevo: resultado.contratistaNuevo.cargo };
      }
      if (original.estado !== resultado.contratistaNuevo.estado) {
        cambios.estado = { anterior: original.estado, nuevo: resultado.contratistaNuevo.estado };
      }

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Contratista actualizado: nueva versión ${resultado.contratistaNuevo.id} (original ${id} desactivado)`,
          contratistaId: resultado.contratistaNuevo.id,
          duracionMs: Date.now() - inicio,
          cambios: Object.keys(cambios).length > 0 ? cambios : undefined,
          metadata: {
            documentosSubidos: documentos.length,
            versionAnterior: id,
            versionNueva: resultado.contratistaNuevo.id
          }
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Contratista actualizado exitosamente (nueva versión creada)',
          data: {
            contratistaOriginal: resultado.contratistaOriginal,
            contratistaNuevo: resultado.contratistaNuevo,
            documentos: resultado.documentos
          }
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error actualizando contratista completo: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  // ===============================
  // GESTIÓN DE DOCUMENTOS
  // ===============================

  @Post(':id/documentos')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('documento'))
  async subirDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('tipo') tipo: string,
    @Req() req: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`📄 Subiendo documento para contratista ${id}: ${tipo}`);

      if (!file) {
        throw new BadRequestException('No se recibió ningún archivo');
      }

      if (!tipo || !Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
        throw new BadRequestException('Tipo de documento inválido');
      }

      const documento = await this.contratistaService.subirDocumento(
        id,
        tipo as TipoDocumento,
        file,
        req.user?.email || 'sistema'
      );

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Documento subido para contratista ${id}: ${tipo} - ${file.originalname}`,
          duracionMs: Date.now() - inicio,
          metadata: {
            tipoDocumento: tipo,
            nombreArchivo: file.originalname,
            tamanoBytes: file.size
          }
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Documento subido exitosamente',
          data: documento
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  @Get(':id/documentos')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerDocumentos(@Param('id') id: string, @Req() req?: any) {
    try {
      this.logger.log(`📋 Obteniendo documentos de contratista ${id}`);

      const documentos = await this.contratistaService.obtenerDocumentos(id);

      return {
        ok: true,
        data: {
          success: true,
          count: documentos.length,
          data: documentos
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: []
        }
      };
    }
  }

  @Get(':id/documentos/:documentoId/descargar')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async descargarDocumento(
    @Param('id') contratistaId: string,
    @Param('documentoId') documentoId: string,
    @Res() res: Response,
    @Req() req?: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`📥 Descargando documento ${documentoId} del contratista ${contratistaId}`);

      const { buffer, nombre, mimeType } = await this.contratistaService.descargarDocumento(
        documentoId,
        contratistaId
      );

      await this.bitacoraService.registrar(
        AccionBitacora.DESCARGAR_ARCHIVO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Descarga de documento: ${nombre}`,
          duracionMs: Date.now() - inicio,
          metadata: {
            documentoId,
            nombreArchivo: nombre,
            contratistaId
          }
        },
        req,
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando documento: ${error.message}`);

      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async eliminarDocumento(
    @Param('id') contratistaId: string,
    @Param('documentoId') documentoId: string,
    @Req() req: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`🗑️ Eliminando documento ${documentoId}`);

      await this.contratistaService.eliminarDocumento(documentoId, contratistaId);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Documento eliminado del contratista ${contratistaId}`,
          duracionMs: Date.now() - inicio,
          metadata: { documentoId }
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Documento eliminado exitosamente'
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error eliminando documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message
        }
      };
    }
  }

  // ===============================
  // AUTOCOMPLETADO
  // ===============================

  @Get('autocomplete/nombre')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async autocompletePorNombre(@Query('q') query: string, @Req() req?: any) {
    try {
      this.logger.log(`🔍 Autocomplete por nombre: "${query}"`);

      if (!query || query.trim().length < 1) {
        return {
          ok: true,
          data: {
            success: true,
            data: []
          }
        };
      }

      const contratistas = await this.contratistaService.buscarPorRazonSocial(query);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        value: c.razonSocial,
        label: `${c.razonSocial} (${c.documentoIdentidad})`,
        documento: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        documentoIdentidad: c.documentoIdentidad,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        createdAt: c.createdAt
      }));

      return {
        ok: true,
        data: {
          success: true,
          data: resultados
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en autocomplete: ${error.message}`);
      return {
        ok: true,
        data: {
          success: true,
          data: []
        }
      };
    }
  }

  @Get('autocomplete/documento')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async autocompletePorDocumento(@Query('q') query: string, @Req() req?: any) {
    try {
      this.logger.log(`🔍 Autocomplete por documento: "${query}"`);

      if (!query || query.trim().length < 1) {
        return {
          ok: true,
          data: {
            success: true,
            data: []
          }
        };
      }

      const contratistas = await this.contratistaService.buscarPorDocumento(query);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        value: c.documentoIdentidad,
        label: `${c.documentoIdentidad} - ${c.razonSocial}`,
        documento: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        documentoIdentidad: c.documentoIdentidad,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        createdAt: c.createdAt
      }));

      return {
        ok: true,
        data: {
          success: true,
          data: resultados
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en autocomplete: ${error.message}`);
      return {
        ok: true,
        data: {
          success: true,
          data: []
        }
      };
    }
  }

  @Get('autocomplete/contrato')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async autocompletePorContrato(@Query('q') query: string, @Req() req?: any) {
    try {
      this.logger.log(`🔍 Autocomplete por contrato: "${query}"`);

      if (!query || query.trim().length < 1) {
        return {
          ok: true,
          data: {
            success: true,
            data: []
          }
        };
      }

      const contratistas = await this.contratistaService.buscarPorNumeroContrato(query);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        value: c.numeroContrato,
        label: `${c.numeroContrato} - ${c.razonSocial} (${c.documentoIdentidad})`,
        documento: c.documentoIdentidad,
        razonSocial: c.razonSocial,
        documentoIdentidad: c.documentoIdentidad,
        numeroContrato: c.numeroContrato,
        createdAt: c.createdAt
      }));

      return {
        ok: true,
        data: {
          success: true,
          data: resultados
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en autocomplete por contrato: ${error.message}`);
      return {
        ok: true,
        data: {
          success: true,
          data: []
        }
      };
    }
  }

  // ===============================
  // VERIFICACIONES
  // ===============================

  @Get('verificar/documento/:documento')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async verificarDocumento(@Param('documento') documento: string, @Req() req?: any) {
    try {
      this.logger.log(`🔍 Verificando documento: "${documento}"`);

      const existe = await this.contratistaService.existePorDocumento(documento);

      return {
        ok: true,
        data: {
          success: true,
          data: { existe, documento },
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al verificar documento',
          data: { existe: false, documento }
        }
      };
    }
  }

  @Get('estadisticas')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerEstadisticas(@Req() req?: any): Promise<any> {
    try {
      this.logger.log('📊 Obteniendo estadísticas de contratistas');

      const estadisticas = await this.contratistaService.obtenerEstadisticas();

      return {
        ok: true,
        data: {
          success: true,
          data: estadisticas,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al obtener estadísticas',
          data: { total: 0, ultimoMes: 0 }
        }
      };
    }
  }

  @Get('recientes')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerRecientes(@Query('limit') limit?: string, @Req() req?: any) {
    try {
      this.logger.log('📊 Obteniendo contratistas recientes');

      const recientes = await this.contratistaService.obtenerRecientes(limit ? parseInt(limit) : 10);

      return {
        ok: true,
        data: {
          success: true,
          count: recientes.length,
          data: recientes,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo recientes: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al obtener contratistas recientes',
          data: []
        }
      };
    }
  }

  @Get('buscar-por-documento/:documento')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.JURIDICA)
  async buscarContratistaPorDocumento(@Param('documento') documento: string, @Req() req?: any) {
    const inicio = Date.now();
    try {
      this.logger.log(`🔍 Buscando contratista por documento: "${documento}"`);

      if (!documento || documento.trim().length < 3) {
        return {
          ok: true,
          data: {
            success: true,
            data: null,
            message: 'Documento debe tener al menos 3 caracteres'
          }
        };
      }

      const contratistas = await this.contratistaService.buscarPorDocumento(documento);

      if (contratistas.length === 0) {
        return {
          ok: true,
          data: {
            success: true,
            data: null,
            message: 'No se encontró ningún contratista con ese documento'
          }
        };
      }

      const contratista = contratistas[0];

      await this.bitacoraService.registrar(
        AccionBitacora.VER_DOCUMENTO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Búsqueda de contratista por documento: ${documento}`,
          duracionMs: Date.now() - inicio,
          metadata: { documento, encontrado: true }
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          data: {
            id: contratista.id,
            documentoIdentidad: contratista.documentoIdentidad,
            razonSocial: contratista.razonSocial,
            nombreRazonSocial: contratista.razonSocial,
            numeroContrato: contratista.numeroContrato,
            email: contratista.email,
            telefono: contratista.telefono,
            direccion: contratista.direccion,
            departamento: contratista.departamento,
            ciudad: contratista.ciudad,
            cargo: contratista.cargo,
            tipoContratista: contratista.tipoContratista,
            estado: contratista.estado,
            objetivoContrato: contratista.objetivoContrato
          }
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error buscando contratista por documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al buscar contratista',
          data: null
        }
      };
    }
  }

  @Get(':id/documentos/descargar-todos')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async descargarTodosDocumentos(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req?: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`📦 Descargando TODOS los documentos del contratista ${id} como ZIP`);

      const { zipBuffer, nombreZip, totalDocumentos } = await this.contratistaService.descargarTodosDocumentos(id);

      await this.bitacoraService.registrar(
        AccionBitacora.DESCARGAR_ARCHIVO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Descarga masiva de documentos (${totalDocumentos} archivos) del contratista ${id}`,
          duracionMs: Date.now() - inicio,
          metadata: {
            contratistaId: id,
            totalDocumentos,
            nombreZip
          }
        },
        req,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreZip)}"`);
      res.setHeader('Content-Length', zipBuffer.length);

      res.send(zipBuffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando todos los documentos: ${error.message}`);

      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }

@Get('buscar-por-contrato/:numeroContrato')
@Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.JURIDICA)
async buscarPorNumeroContrato(@Param('numeroContrato') numeroContrato: string, @Req() req?: any) {
  const inicio = Date.now();
  try {
    this.logger.log(`🔍 Buscando contratista por número de contrato: "${numeroContrato}"`);

    if (!numeroContrato || numeroContrato.trim().length < 1) {
      return {
        ok: true,
        data: {
          success: true,
          data: null,
          message: 'Número de contrato requerido'
        }
      };
    }

    // ✅ USAR el método que ya tiene relaciones
    const contratista = await this.contratistaService.buscarPorNumeroContratoExacto(numeroContrato);

    if (!contratista) {
      return {
        ok: true,
        data: {
          success: true,
          data: null,
          message: 'No se encontró ningún contratista con ese número de contrato'
        }
      };
    }

    // ✅ La respuesta YA incluye documentos porque buscarPorNumeroContratoExacto tiene relations: ['documentos']
    this.logger.log(`✅ Contratista encontrado: ${contratista.razonSocial} con ${contratista.documentos?.length || 0} documentos`);

    return {
      ok: true,
      data: {
        success: true,
        data: contratista
      }
    };
  } catch (error) {
    this.logger.error(`❌ Error buscando contratista por número de contrato: ${error.message}`);
    return {
      ok: true,
      data: {
        success: false,
        message: error.message,
        data: null
      }
    };
  }
}
}