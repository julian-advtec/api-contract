import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ContratistaTokenService } from '../services/contratista-token.service';
import { ContratistaService } from '../services/contratista.service';

@Controller('contratistas/publico')
@Public()
export class ContratistaPublicoController {
  private readonly logger = new Logger(ContratistaPublicoController.name);

  constructor(
    private readonly tokenService: ContratistaTokenService,
    private readonly contratistaService: ContratistaService,
  ) {
    this.logger.log('🚀🚀🚀 CONTRATISTA PUBLICO CONTROLLER INICIALIZADO');
    this.logger.log('📡 RUTAS REGISTRADAS:');
    this.logger.log('   ✅ GET /contratistas/publico/verificar/:token');
    this.logger.log('   ✅ POST /contratistas/publico/guardar/:token');
    this.logger.log('   ✅ GET /contratistas/publico/health');
  }

  // ✅ Ruta de health check para probar que el controlador funciona
  @Get('health')
  @Public()
  async healthCheck() {
    this.logger.log('🏥 Health check llamado');
    return {
      ok: true,
      status: 'ok',
      service: 'contratista-publico',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('verificar/:token')
  @HttpCode(HttpStatus.OK)
  @Public()
  async verificarToken(@Param('token') token: string) {
    this.logger.log('🔍🔍🔍 ===== PETICIÓN RECIBIDA EN VERIFICAR TOKEN =====');
    this.logger.log(`📌 Token: ${token.substring(0, 30)}...`);
    this.logger.log(`📌 Longitud del token: ${token.length}`);
    
    try {
      this.logger.log('🔍 Verificando token de acceso...');

      const resultado = await this.tokenService.verificarTokenAcceso(token);

      if (!resultado.valido) {
        this.logger.warn(`⚠️ Token inválido: ${resultado.error}`);
        return {
          ok: true,
          data: {
            success: false,
            message: resultado.error || 'Token inválido',
            data: null,
          },
        };
      }

      this.logger.log(`✅ Token válido para: ${resultado.contratista?.razonSocial}`);
      return {
        ok: true,
        data: {
          success: true,
          message: 'Token válido',
          data: resultado.contratista,
        },
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando token: ${error.message}`);
      this.logger.error(`❌ Stack: ${error.stack}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null,
        },
      };
    }
  }

  @Post('guardar/:token')
  @HttpCode(HttpStatus.OK)
  @Public()
  async guardarDatos(
    @Param('token') token: string,
    @Body() body: any,
  ) {
    this.logger.log('📝📝📝 ===== PETICIÓN RECIBIDA EN GUARDAR DATOS =====');
    this.logger.log(`📌 Token: ${token.substring(0, 30)}...`);
    
    try {
      this.logger.log('📝 Guardando datos de contratista vía token');

      const verificar = await this.tokenService.verificarTokenAcceso(token);
      
      if (!verificar.valido) {
        this.logger.warn(`⚠️ Token inválido: ${verificar.error}`);
        return {
          ok: true,
          data: {
            success: false,
            message: verificar.error || 'Token inválido',
            data: null,
          },
        };
      }

      const contratistaId = verificar.contratista.id;

      const datosActualizar: any = {};
      Object.keys(body).forEach(key => {
        if (body[key] !== undefined && body[key] !== null) {
          datosActualizar[key] = body[key];
        }
      });

      const contratistaActualizado = await this.contratistaService.actualizar(
        contratistaId,
        datosActualizar
      );

      this.logger.log(`✅ Datos actualizados: ${contratistaActualizado.razonSocial}`);

      return {
        ok: true,
        data: {
          success: true,
          message: 'Información guardada exitosamente',
          data: {
            id: contratistaActualizado.id,
            razonSocial: contratistaActualizado.razonSocial,
            updatedAt: contratistaActualizado.updatedAt,
          },
        },
      };
    } catch (error) {
      this.logger.error(`❌ Error guardando datos: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null,
        },
      };
    }
  }
}