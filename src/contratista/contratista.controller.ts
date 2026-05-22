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
  // HEALTH CHECK (Público)
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
  // CRUD PRINCIPAL - ADMIN Y JURIDICA
  // ===============================

  @Get()
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
  async obtenerTodos(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: any,
  ) {
    const inicio = Date.now();
    try {
      this.logger.log(`📋 Obteniendo todos los contratistas - Usuario: ${req.user?.username} (${req.user?.role})`);

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

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  // ===============================
  // BÚSQUEDAS - ADMIN Y JURIDICA
  // ===============================

  @Get('buscar')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Get('documento/:documento')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Get('buscar-por-documento/:documento')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Get('buscar-por-contrato/:numeroContrato')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  // ===============================
  // AUTOCOMPLETADO - ADMIN Y JURIDICA
  // ===============================

  @Get('autocomplete/nombre')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  // CREAR CONTRATISTA - ADMIN Y JURIDICA
  // ===============================

  @Post()
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
  @UseInterceptors(FilesInterceptor('documentos', 20))
  async crearContratistaCompleto(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any
  ) {
    const inicio = Date.now();
    try {
      this.logger.log('📝 Creando contratista con documentos');
      
      if (files && files.length > 0) {
        this.logger.log(`📎 Archivos recibidos: ${files.length}`);
        files.forEach((file, index) => {
          this.logger.log(`   ${index}: ${file.originalname} - ${file.mimetype} - ${file.size} bytes`);
        });
      }

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
          this.logger.log(`📄 Procesando archivo ${i}: tipo=${tipo}, archivo=${files[i].originalname}`);
          
          if (tipo && Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
            documentos.push({
              tipo: tipo as TipoDocumento,
              archivo: files[i]
            });
          } else {
            this.logger.warn(`⚠️ Tipo de documento inválido para archivo ${i}: ${tipo}`);
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
  // ACTUALIZAR CONTRATISTA - ADMIN Y JURIDICA
  // ===============================

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

      const contratista = await this.contratistaService.actualizar(id, updateData);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Contratista actualizado: ${contratista.razonSocial}`,
          contratistaId: contratista.id,
          duracionMs: Date.now() - inicio,
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

@Put(':id/completo')
@Roles(UserRole.ADMIN, UserRole.JURIDICA)
@UseInterceptors(FilesInterceptor('documentos', 20))
async actualizarContratistaCompleto(
  @Param('id') id: string,
  @Body() body: any,
  @UploadedFiles() files: Express.Multer.File[],
  @Req() req: any
) {
  const inicio = Date.now();
  try {
    this.logger.log(`✏️ ACTUALIZANDO CON VERSIONADO contratista: ${id}`);

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

    const documentos = [];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const tipo = body[`tipo_documento_${i}`];
        if (tipo && Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
          documentos.push({ tipo: tipo as TipoDocumento, archivo: files[i] });
        }
      }
    }

    // ✅ USAR EL NUEVO MÉTODO CON VERSIONADO
    const resultado = await this.contratistaService.actualizarConVersionado(
      id,
      datosActualizar,
      documentos,
      req.user?.email || 'sistema'
    );

    await this.bitacoraService.registrar(
      AccionBitacora.ADMIN_EDITAR_USUARIO,
      ModuloBitacora.ADMINISTRACION,
      req.user,
      undefined,
      {
        detalles: `Contratista versionado: Anterior ID ${resultado.contratistaAnterior.id} (INACTIVO) → Nuevo ID ${resultado.contratistaNuevo.id} (ACTIVO)`,
        contratistaId: resultado.contratistaNuevo.id,
        duracionMs: Date.now() - inicio,
      },
      req,
    );

    return {
      ok: true,
      data: {
        success: true,
        message: 'Contratista actualizado correctamente (versión anterior conservada como inactiva)',
        data: resultado
      }
    };
  } catch (error) {
    this.logger.error(`❌ Error actualizando contratista: ${error.message}`);
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
  // ELIMINAR CONTRATISTA - ADMIN Y JURIDICA
  // ===============================

 @Delete(':id')
@Roles(UserRole.ADMIN, UserRole.JURIDICA)
async eliminar(@Param('id') id: string, @Req() req?: any) {
  const inicio = Date.now();
  try {
    this.logger.log(`🗑️ Desactivando contratista: ${id}`);

    // Verificar que existe
    const contratistaExistente = await this.contratistaService.buscarPorId(id);
    
    if (!contratistaExistente) {
      return {
        ok: true,
        data: {
          success: false,
          message: `Contratista con ID ${id} no encontrado`
        }
      };
    }

    // Cambiar estado a INACTIVO en lugar de eliminar físicamente
    const contratista = await this.contratistaService.actualizar(id, { estado: 'INACTIVO' });

    await this.bitacoraService.registrar(
      AccionBitacora.ADMIN_ELIMINAR_USUARIO,
      ModuloBitacora.ADMINISTRACION,
      req.user,
      undefined,
      {
        detalles: `Contratista desactivado: ${contratista.razonSocial} (${contratista.documentoIdentidad})`,
        contratistaId: id,
        duracionMs: Date.now() - inicio,
      },
      req,
    );

    return {
      ok: true,
      data: {
        success: true,
        message: 'Contratista desactivado exitosamente',
        data: contratista
      }
    };
  } catch (error) {
    this.logger.error(`❌ Error desactivando contratista: ${error.message}`);
    return {
      ok: true,
      data: {
        success: false,
        message: error.message || 'Error al desactivar contratista'
      }
    };
  }
}

  // ===============================
  // GESTIÓN DE DOCUMENTOS - ADMIN Y JURIDICA
  // ===============================

  @Get(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Post(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Get(':id/documentos/:documentoId/descargar')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Get(':id/documentos/descargar-todos')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  // VERIFICACIONES Y ESTADÍSTICAS - ADMIN Y JURIDICA
  // ===============================

  @Get('verificar/documento/:documento')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
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
}