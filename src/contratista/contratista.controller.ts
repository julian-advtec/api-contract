import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ContratistaService } from './contratista.service';

@Controller('contratistas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContratistasController {
  private readonly logger = new Logger(ContratistasController.name);

  constructor(private readonly contratistaService: ContratistaService) { }

  // ===============================
  // ENDPOINT DE SALUD
  // ===============================
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'contratistas',
      timestamp: new Date().toISOString(),
    };
  }

  // ===============================
  // ✅ NUEVO: ENDPOINT DE BÚSQUEDA COMBINADA
  // ===============================
  @Get('buscar/combinado')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async buscarCombinado(
    @Query('tipo') tipo: 'nombre' | 'documento' | 'contrato',
    @Query('termino') termino: string
  ) {
    try {
      this.logger.log(`🔍 Búsqueda combinada solicitada: ${tipo} - "${termino}"`);

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

      // Formatear respuesta para el frontend
      const resultados = contratistas.map((c) => ({
        id: c.id,
        documentoIdentidad: c.documentoIdentidad,
        nombreCompleto: c.nombreCompleto,
        numeroContrato: c.numeroContrato || 'Sin contrato',
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

  // ===============================
  // CRUD SIN ELIMINAR
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

  /*
  
  @Get('estadisticas')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async obtenerEstadisticas() {
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
  } */

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

      // ✅✅✅ CORREGIDO: Mapear para incluir información completa como en autocomplete
      const resultados = contratistas.map((c) => ({
        id: c.id,
        documentoIdentidad: c.documentoIdentidad,
        nombreCompleto: c.nombreCompleto,
        numeroContrato: c.numeroContrato || 'Sin contrato',
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
  async crear(@Body() body: { documentoIdentidad: string, nombreCompleto: string, numeroContrato?: string }) {
    try {
      this.logger.log('📝 Creando nuevo contratista');

      // Validar datos requeridos
      if (!body.documentoIdentidad || !body.nombreCompleto) {
        throw new BadRequestException('Documento de identidad y nombre completo son requeridos');
      }

      const contratista = await this.contratistaService.crear({
        documentoIdentidad: body.documentoIdentidad,
        nombreCompleto: body.nombreCompleto,
        numeroContrato: body.numeroContrato,
      });

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

      if (error instanceof BadRequestException) {
        return {
          ok: true,
          data: {
            success: false,
            message: error.message,
            data: null
          }
        };
      }

      if (error instanceof ConflictException) {
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

  @Put(':id')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async actualizar(
    @Param('id') id: string,
    @Body() body: Partial<{ documentoIdentidad: string, nombreCompleto: string, numeroContrato?: string }>
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

      if (error instanceof BadRequestException) {
        return {
          ok: true,
          data: {
            success: false,
            message: error.message,
            data: null
          }
        };
      }

      if (error instanceof ConflictException) {
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
  // ENDPOINTS PARA AUTOCOMPLETADO
  // ===============================
  @Get('autocomplete/nombre')
  @Roles(UserRole.RADICADOR, UserRole.ADMIN, UserRole.SUPERVISOR)
  async autocompletePorNombre(@Query('q') query: string) {
    try {
      this.logger.log(`🔍 Autocomplete por nombre: "${query}"`);

      // ✅✅✅ CAMBIADO: Ahora empieza con 1 carácter
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

      // ✅ AGREGAR LOG PARA VERIFICAR
      console.log(`🔍 Backend: contratistas encontrados: ${contratistas.length}`);
      console.log('🔍 Backend: Primero:', contratistas.length > 0 ? contratistas[0] : 'Ninguno');

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

      const response = {
        ok: true,
        data: {
          success: true,
          data: resultados
        }
      };

      console.log('🔍 Backend: Response completo:', JSON.stringify(response));

      return response;
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

      // ✅✅✅ CAMBIADO: Ahora empieza con 1 carácter
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
  // VERIFICACIÓN DE DOCUMENTO (PARA CREACIÓN)
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

  // ===============================
  // ✅ NUEVO: ENDPOINT PARA BÚSQUEDA AVANZADA
  // ===============================
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
}