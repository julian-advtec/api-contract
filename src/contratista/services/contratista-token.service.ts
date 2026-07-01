// src/contratista/services/contratista-token.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ContratistaService } from '../services/contratista.service';

@Injectable()
export class ContratistaTokenService {
  private readonly logger = new Logger(ContratistaTokenService.name);
  private readonly tokenExpiration = '24h';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly contratistaService: ContratistaService,
  ) { }

  /**
   * Genera un token de acceso para el contratista
   */
  async generarTokenAcceso(contratistaId: string, emailDestino?: string): Promise<{
    token: string;
    expiraEn: Date;
    enlace: string;
  }> {
    try {
      const contratista = await this.contratistaService.buscarPorId(contratistaId);

      if (!contratista) {
        throw new NotFoundException(`Contratista con ID ${contratistaId} no encontrado`);
      }

      const email = emailDestino || contratista.email;

      if (!email) {
        throw new BadRequestException('El contratista no tiene email registrado');
      }

      const payload = {
        sub: contratista.id,
        email: email,
        documento: contratista.documentoIdentidad,
        razonSocial: contratista.razonSocial,
        type: 'contratista-access',
        iat: Math.floor(Date.now() / 1000),
      };

      const token = this.jwtService.sign(payload, {
        secret: this.configService.get<string>('JWT_SECRET') || 'secret-key',
        expiresIn: this.tokenExpiration,
      });

      const expiraEn = new Date();
      expiraEn.setHours(expiraEn.getHours() + 24);

      // ✅ SOLO LEE DE .env - Sin forzar nada
      const frontendUrl = this.configService.get<string>('FRONTEND_PUBLIC_URL') || 'http://localhost:4201';
      const enlace = `${frontendUrl}/contratistas/publico/verificar/${token}`;

      this.logger.log(`✅ Token generado para: ${contratista.razonSocial} (${contratista.id})`);
      this.logger.log(`🔗 Enlace: ${enlace}`);
      this.logger.log(`📍 FRONTEND_PUBLIC_URL: ${frontendUrl}`);

      return { token, expiraEn, enlace };
    } catch (error) {
      this.logger.error(`❌ Error generando token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verifica y valida el token de acceso
   */
  async verificarTokenAcceso(token: string): Promise<{
    valido: boolean;
    contratista?: any;
    error?: string;
  }> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET') || 'secret-key',
      });

      if (payload.type !== 'contratista-access') {
        return {
          valido: false,
          error: 'Token inválido para acceso de contratista'
        };
      }

      const contratista = await this.contratistaService.buscarPorId(payload.sub);

      if (!contratista) {
        return {
          valido: false,
          error: 'Contratista no encontrado'
        };
      }

      if (contratista.email !== payload.email) {
        return {
          valido: false,
          error: 'Los datos del contratista no coinciden con el token'
        };
      }

      this.logger.log(`✅ Token verificado para: ${contratista.razonSocial}`);

      return {
        valido: true,
        contratista: {
          id: contratista.id,
          tipoDocumento: contratista.tipoDocumento,
          documentoIdentidad: contratista.documentoIdentidad,
          razonSocial: contratista.razonSocial,
          representanteLegal: contratista.representanteLegal,
          documentoRepresentante: contratista.documentoRepresentante,
          telefono: contratista.telefono,
          email: contratista.email,
          direccion: contratista.direccion,
          departamento: contratista.departamento,
          ciudad: contratista.ciudad,
          tipoContratista: contratista.tipoContratista,
          estado: contratista.estado,
          numeroContrato: contratista.numeroContrato,
          cargo: contratista.cargo,
          objetivoContrato: contratista.objetivoContrato,
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando token: ${error.message}`);

      if (error.name === 'TokenExpiredError') {
        return {
          valido: false,
          error: 'El enlace ha expirado. Por favor solicite uno nuevo.'
        };
      }

      if (error.name === 'JsonWebTokenError') {
        return {
          valido: false,
          error: 'El enlace no es válido.'
        };
      }

      return {
        valido: false,
        error: error.message || 'Error al verificar el token'
      };
    }
  }
}