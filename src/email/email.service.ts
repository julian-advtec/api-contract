import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  ext_expires_in: number;
}

interface GraphError {
  error: {
    code: string;
    message: string;
    innerError?: any;
  };
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private config: ConfigService) {}

  isEmailConfigured(): boolean {
    const tenantId = this.config.get<string>('AZURE_TENANT_ID');
    const clientId = this.config.get<string>('AZURE_CLIENT_ID');
    const clientSecret = this.config.get<string>('AZURE_CLIENT_SECRET');
    const sender = this.config.get<string>('EMAIL_FROM');

    const configured = !!(tenantId && clientId && clientSecret && sender);
    
    if (!configured) {
      this.logger.warn('❌ Azure email configuration incomplete');
    }
    
    return configured;
  }

  private async getAccessToken(): Promise<string> {
    try {
      const tenantId = this.config.get<string>('AZURE_TENANT_ID');
      const clientId = this.config.get<string>('AZURE_CLIENT_ID');
      const clientSecret = this.config.get<string>('AZURE_CLIENT_SECRET');

      // 🔥 VALIDAR QUE NO SEAN UNDEFINED
      if (!tenantId || !clientId || !clientSecret) {
        throw new Error('Azure configuration missing');
      }

      this.logger.debug(`🔐 Getting token for tenant: ${tenantId}, client: ${clientId}`);

      const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('scope', 'https://graph.microsoft.com/.default');
      params.append('grant_type', 'client_credentials');

      const response = await axios.post<TokenResponse>(url, params.toString(), {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 30000,
      });

      if (!response.data.access_token) {
        throw new Error('No access token received');
      }

      this.logger.debug('✅ Azure access token obtained successfully');
      return response.data.access_token;

    } catch (error: any) {
      const errorData = error.response?.data;
      this.logger.error('❌ Azure token error:', {
        status: error.response?.status,
        error: errorData?.error,
        description: errorData?.error_description,
        correlationId: errorData?.correlation_id,
        timestamp: errorData?.timestamp
      });

      throw new Error(`Azure authentication failed: ${errorData?.error_description || error.message}`);
    }
  }

  async sendTwoFactorCode(email: string, code: string): Promise<void> {
    if (!this.isEmailConfigured()) {
      throw new Error('Azure email service not configured');
    }

    this.logger.log(`📧 Sending 2FA code to: ${email}`);

    try {
      const accessToken = await this.getAccessToken();
      const senderEmail = this.config.get<string>('EMAIL_FROM');

      if (!senderEmail) {
        throw new Error('EMAIL_FROM not configured');
      }

      const emailData = {
        message: {
          subject: 'Código de Verificación - Sistema de Contratos',
          body: {
            contentType: 'HTML',
            content: this.getTwoFactorEmailTemplate(code),
          },
          toRecipients: [
            {
              emailAddress: {
                address: email,
              },
            },
          ],
        },
        saveToSentItems: true,
      };

      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
        emailData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Sistema-Contratos/1.0',
          },
          timeout: 30000,
        }
      );

      this.logger.log(`✅ 2FA code sent successfully to: ${email}`);
      
    } catch (error: any) {
      const errorData = error.response?.data as GraphError;
      this.logger.error(`❌ Failed to send 2FA email to ${email}:`, {
        status: error.response?.status,
        error: errorData?.error?.code,
        message: errorData?.error?.message,
      });

      throw new Error(`Failed to send email: ${errorData?.error?.message || error.message}`);
    }
  }

  async sendWelcomeEmail(email: string, username: string): Promise<void> {
    if (!this.isEmailConfigured()) {
      this.logger.warn('Azure email not configured, skipping welcome email');
      return;
    }

    try {
      const accessToken = await this.getAccessToken();
      const senderEmail = this.config.get<string>('EMAIL_FROM');

      if (!senderEmail) {
        this.logger.warn('EMAIL_FROM not configured, skipping welcome email');
        return;
      }

      const emailData = {
        message: {
          subject: 'Bienvenido al Sistema de Contratos',
          body: {
            contentType: 'HTML',
            content: this.getWelcomeEmailTemplate(username),
          },
          toRecipients: [
            {
              emailAddress: {
                address: email,
              },
            },
          ],
        },
        saveToSentItems: true,
      };

      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
        emailData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      this.logger.log(`✅ Welcome email sent to: ${email}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send welcome email to ${email}:`, error.message);
      // Don't throw error for welcome emails
    }
  }

  private getTwoFactorEmailTemplate(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .code { font-size: 32px; font-weight: bold; padding: 20px; background: #1a365d; color: #fbbf24; text-align: center; border-radius: 8px; letter-spacing: 8px; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="color: #1a365d; margin: 0;">Código de Verificación</h2>
          </div>
          <p>Hola,</p>
          <p>Tu código de verificación para el Sistema de Contratos es:</p>
          <div class="code">${code}</div>
          <p>Este código expirará en <strong>10 minutos</strong>.</p>
          <p>Si no solicitaste este código, por favor ignora este mensaje.</p>
          <div class="footer">
            <p>Sistema de Contratos<br>La María</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getWelcomeEmailTemplate(username: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="color: #1a365d; margin: 0;">¡Bienvenido al Sistema de Contratos!</h2>
          </div>
          <p>Hola <strong>${username}</strong>,</p>
          <p>Tu cuenta ha sido creada exitosamente en el Sistema de Contratos de La María.</p>
          <p>Ahora puedes acceder al sistema con tu nombre de usuario y contraseña.</p>
          <div class="footer">
            <p>Sistema de Contratos<br>La María</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}