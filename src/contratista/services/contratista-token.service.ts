// src/contratista/services/contratista-token.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ContratistaService } from '../services/contratista.service';

@Injectable()
export class ContratistaTokenService {
  private readonly logger = new Logger(ContratistaTokenService.name);
  private readonly tokenExpiration = '24h';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly contratistaService: ContratistaService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * ✅ Verificar si un token ya fue usado (usando SQL directo)
   */
  async tokenYaFueUsado(token: string): Promise<boolean> {
    try {
      const result = await this.dataSource.query(
        'SELECT COUNT(*) as count FROM tokens_usados WHERE token = $1',
        [token]
      );
      const count = parseInt(result[0]?.count || '0', 10);
      this.logger.log(`🔍 Token usado check: ${count > 0 ? 'SÍ' : 'NO'} (${token.substring(0, 20)}...)`);
      return count > 0;
    } catch (error) {
      this.logger.error(`❌ Error verificando token usado: ${error.message}`);
      return false;
    }
  }

  /**
   * ✅ Marcar un token como usado (usando SQL directo)
   */
  async marcarTokenComoUsado(token: string, contratistaId: string, formularioId?: string): Promise<void> {
    try {
      // Verificar si ya existe
      const existe = await this.dataSource.query(
        'SELECT COUNT(*) as count FROM tokens_usados WHERE token = $1',
        [token]
      );
      const count = parseInt(existe[0]?.count || '0', 10);
      
      if (count > 0) {
        this.logger.log(`ℹ️ Token ya estaba marcado como usado: ${token.substring(0, 20)}...`);
        return;
      }
      
      await this.dataSource.query(
        `INSERT INTO tokens_usados (token, contratista_id, formulario_id, fecha_uso) 
         VALUES ($1, $2, $3, NOW())`,
        [token, contratistaId, formularioId || null]
      );
      this.logger.log(`✅ Token marcado como usado: ${token.substring(0, 20)}...`);
    } catch (error) {
      this.logger.error(`❌ Error marcando token como usado: ${error.message}`);
      throw error;
    }
  }

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

      const frontendUrl = this.configService.get<string>('FRONTEND_PUBLIC_URL') || 'http://localhost:4201';
      const enlace = `${frontendUrl}/contratistas/publico/verificar/${token}`;

      this.logger.log(`✅ Token generado para: ${contratista.razonSocial}`);
      this.logger.log(`🔗 Enlace: ${enlace}`);

      return { token, expiraEn, enlace };
    } catch (error) {
      this.logger.error(`❌ Error generando token: ${error.message}`);
      throw error;
    }
  }

  async verificarTokenAcceso(token: string): Promise<{
    valido: boolean;
    contratista?: any;
    error?: string;
    tokenUsado?: boolean;
  }> {
    try {
      // ✅ Verificar si el token ya fue usado
      const usado = await this.tokenYaFueUsado(token);
      if (usado) {
        this.logger.warn(`⚠️ Token ya fue usado: ${token.substring(0, 20)}...`);
        return {
          valido: true,
          tokenUsado: true,
          contratista: null,
          error: 'Este enlace ya ha sido utilizado.',
        };
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET') || 'secret-key',
      });

      if (payload.type !== 'contratista-access') {
        return {
          valido: false,
          error: 'Token inválido para acceso de contratista',
        };
      }

      const contratista = await this.contratistaService.buscarPorId(payload.sub);

      if (!contratista) {
        return {
          valido: false,
          error: 'Contratista no encontrado',
        };
      }

      if (contratista.estado !== 'ACTIVO') {
        return {
          valido: false,
          error: 'El contratista no está activo',
        };
      }

      if (contratista.email !== payload.email) {
        return {
          valido: false,
          error: 'Los datos del contratista no coinciden con el token',
        };
      }

      this.logger.log(`✅ Token verificado para: ${contratista.razonSocial}`);

      return {
        valido: true,
        tokenUsado: false,
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
          documentos: contratista.documentos || [],
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Error verificando token: ${error.message}`);

      if (error.name === 'TokenExpiredError') {
        return {
          valido: false,
          error: 'El enlace ha expirado. Por favor solicite uno nuevo.',
        };
      }

      if (error.name === 'JsonWebTokenError') {
        return {
          valido: false,
          error: 'El enlace no es válido.',
        };
      }

      return {
        valido: false,
        error: error.message || 'Error al verificar el token',
      };
    }
  }
}