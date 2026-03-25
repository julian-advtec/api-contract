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
import type { Response } from 'express'; // ✅ Usar import type
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ContratistaService } from './contratista.service';
import { TipoDocumento } from './entities/documento-contratista.entity';

@Controller('contratistas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContratistasController {
  private readonly logger = new Logger(ContratistasController.name);

  constructor(private readonly contratistaService: ContratistaService) { }

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
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerTodos(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    try {
      this.logger.log('📋 Obteniendo todos los contratistas');

      const contratistas = await this.contratistaService.obtenerTodos({
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });

      return {
        ok: true,
        data: {
          success: true,
          count: contratistas.length,
          data: contratistas,
          timestamp: new Date().toISOString(),
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratistas: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: 'Error al obtener contratistas',
          data: []
        }
      };
    }
  }

  @Get('buscar')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async buscar(@Query('termino') termino: string) {
    try {
      this.logger.log(`🔍 Buscando contratistas por término: "${termino}"`);

      const contratistas = await this.contratistaService.buscarPorTermino(termino);

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
    @Query('termino') termino: string
  ) {
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
        nombreCompleto: c.nombreCompleto,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        email: c.email,
        telefono: c.telefono,
        cargo: c.cargo,
        createdAt: c.createdAt
      }));

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
    @Query('offset') offset?: string
  ) {
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
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerPorId(@Param('id') id: string) {
    try {
      this.logger.log(`🔍 Obteniendo contratista por ID: ${id}`);

      const contratista = await this.contratistaService.buscarPorId(id);

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
  async obtenerContratistaCompleto(@Param('id') id: string) {
    try {
      this.logger.log(`🔍 Obteniendo contratista completo: ${id}`);

      const contratistaCompleto = await this.contratistaService.obtenerContratistaCompleto(id);

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
  async obtenerPorDocumento(@Param('documento') documento: string) {
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
        nombreCompleto: c.nombreCompleto,
        numeroContrato: c.numeroContrato || 'Sin contrato',
        email: c.email,
        telefono: c.telefono,
        cargo: c.cargo,
        createdAt: c.createdAt
      }));

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

  @Post()
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async crear(@Body() body: {
    documentoIdentidad: string;
    nombreCompleto: string;
    numeroContrato?: string;
    email?: string;
    telefono?: string;
    direccion?: string;
    cargo?: string;
  }) {
    try {
      this.logger.log('📝 Creando nuevo contratista');

      if (!body.documentoIdentidad || !body.nombreCompleto) {
        throw new BadRequestException('Documento de identidad y nombre completo son requeridos');
      }

      const contratista = await this.contratistaService.crear(body);

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
    @Req() req: any // ✅ Agregar tipo any explícito
  ) {
    try {
      this.logger.log('📝 Creando contratista con documentos');

      const datosContratista = {
        documentoIdentidad: body.documentoIdentidad,
        nombreCompleto: body.nombreCompleto,
        numeroContrato: body.numeroContrato,
        email: body.email,
        telefono: body.telefono,
        direccion: body.direccion,
        cargo: body.cargo
      };

      if (!datosContratista.documentoIdentidad || !datosContratista.nombreCompleto) {
        throw new BadRequestException('Documento y nombre son requeridos');
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

  @Put(':id')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async actualizar(
    @Param('id') id: string,
    @Body() body: Partial<{
      documentoIdentidad: string;
      nombreCompleto: string;
      numeroContrato?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      cargo?: string;
    }>
  ) {
    try {
      this.logger.log(`✏️ Actualizando contratista: ${id}`);

      const contratista = await this.contratistaService.actualizar(id, body);

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

      if (error instanceof NotFoundException) {
        return {
          ok: true,
          data: {
            success: false,
            message: error.message,
            data: null
          }
        };
      }

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
          message: 'Error al actualizar contratista',
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
    @Req() req: any // ✅ Agregar tipo any explícito
  ) {
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
  async obtenerDocumentos(@Param('id') id: string) {
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
    @Res() res: Response // ✅ Ya está con import type
  ) {
    try {
      this.logger.log(`📥 Descargando documento ${documentoId}`);

      const { buffer, nombre, mimeType } = await this.contratistaService.descargarDocumento(
        documentoId,
        contratistaId
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
    @Param('documentoId') documentoId: string
  ) {
    try {
      this.logger.log(`🗑️ Eliminando documento ${documentoId}`);

      await this.contratistaService.eliminarDocumento(documentoId, contratistaId);

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
  async autocompletePorNombre(@Query('q') query: string) {
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

      const contratistas = await this.contratistaService.buscarPorNombre(query);

      const resultados = contratistas.map((c) => ({
        id: c.id,
        value: c.nombreCompleto,
        label: `${c.nombreCompleto} (${c.documentoIdentidad})`,
        documento: c.documentoIdentidad,
        nombreCompleto: c.nombreCompleto,
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
  async autocompletePorDocumento(@Query('q') query: string) {
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
        label: `${c.documentoIdentidad} - ${c.nombreCompleto}`,
        documento: c.documentoIdentidad,
        nombreCompleto: c.nombreCompleto,
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
  async autocompletePorContrato(@Query('q') query: string) {
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
        label: `${c.numeroContrato} - ${c.nombreCompleto} (${c.documentoIdentidad})`,
        documento: c.documentoIdentidad,
        nombreCompleto: c.nombreCompleto,
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
  async verificarDocumento(@Param('documento') documento: string) {
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
  async obtenerEstadisticas(): Promise<any> { // ✅ Agregar tipo de retorno explícito
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
  async obtenerRecientes(@Query('limit') limit?: string) {
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

  /**
 * Buscar contratista por documento (NIT/CC) - para autocompletado en jurídica
 */
  @Get('buscar-por-documento/:documento')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.JURIDICA)
  async buscarContratistaPorDocumento(@Param('documento') documento: string) {
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

      // Tomar el primero (más relevante)
      const contratista = contratistas[0];

      return {
        ok: true,
        data: {
          success: true,
          data: {
            id: contratista.id,
            documentoIdentidad: contratista.documentoIdentidad,
            nombreCompleto: contratista.nombreCompleto,
            nombreRazonSocial: contratista.nombreCompleto,
            numeroContrato: contratista.numeroContrato,
            email: contratista.email,
            telefono: contratista.telefono,
            direccion: contratista.direccion,
            cargo: contratista.cargo,
            tipoContratista: contratista.tipoContratista,
            estado: contratista.estado,
            observaciones: contratista.observaciones
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
}