import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeTransporter();
  }

  private async initializeTransporter() {
    const host = this.configService.get<string>('EMAIL_HOST');
    const port = this.configService.get<number>('EMAIL_PORT');
    const user = this.configService.get<string>('EMAIL_USER');
    const pass = this.configService.get<string>('EMAIL_PASS');

    // Validar configuración
    if (!user || !pass) {
      this.logger.warn('⚠️ Credenciales de email no configuradas. El servicio de email no funcionará.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      auth: { user, pass },
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
    });

    try {
      await this.transporter.verify();
      this.logger.log('✅ Transporter de email configurado correctamente');
    } catch (error) {
      this.logger.error('❌ Error configurando email transporter:', error);
    }
  }

  async sendTwoFactorCode(email: string, code: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.error('Transporter de email no inicializado');
      return false;
    }

    const mailOptions = {
      from: this.configService.get<string>('EMAIL_FROM'),
      to: email,
      subject: '🔐 Código de Verificación - Sistema de Contratos',
      html: this.getTwoFactorEmailTemplate(code),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Código 2FA enviado a: ${email} - Message ID: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error enviando email a ${email}:`, error);
      throw new Error(`No se pudo enviar el código de verificación: ${error.message}`);
    }
  }

  async sendWelcomeEmail(email: string, username: string): Promise<boolean> {
    if (!this.transporter) return false;

    const mailOptions = {
      from: this.configService.get<string>('EMAIL_FROM'),
      to: email,
      subject: '👋 Bienvenido al Sistema de Contratos',
      html: this.getWelcomeEmailTemplate(username),
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Email de bienvenida enviado a: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error enviando email de bienvenida:`, error);
      return false;
    }
  }

  private getTwoFactorEmailTemplate(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Código de Verificación</title>
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0; 
            padding: 0; 
            background-color: #f4f4f4;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            color: white; 
            padding: 30px 20px; 
            text-align: center; 
          }
          .header h1 { 
            margin: 0; 
            font-size: 24px; 
            font-weight: 600;
          }
          .content { 
            padding: 40px 30px; 
          }
          .code-container { 
            text-align: center; 
            margin: 30px 0; 
          }
          .code { 
            background: #1f2937; 
            color: #fbbf24; 
            padding: 20px; 
            font-size: 32px; 
            font-weight: bold; 
            letter-spacing: 8px; 
            border-radius: 8px;
            display: inline-block;
            font-family: 'Courier New', monospace;
            margin: 10px 0;
          }
          .warning { 
            background: #fef3c7; 
            border-left: 4px solid #f59e0b; 
            padding: 15px; 
            margin: 20px 0;
            border-radius: 4px;
            font-size: 14px;
          }
          .footer { 
            text-align: center; 
            padding: 20px;
            background: #f8fafc;
            color: #6b7280;
            font-size: 12px;
            border-top: 1px solid #e5e7eb;
          }
          .button {
            display: inline-block;
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 5px;
            margin: 10px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Sistema de Contratos</h1>
            <p>Verificación en Dos Pasos</p>
          </div>
          
          <div class="content">
            <h2>Hola,</h2>
            <p>Has solicitado iniciar sesión en el <strong>Sistema de Contratos</strong>. 
               Usa el siguiente código para completar tu autenticación:</p>
            
            <div class="code-container">
              <div class="code">${code}</div>
            </div>
            
            <div class="warning">
              <strong>⚠️ Información importante:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Este código expirará en <strong>10 minutos</strong></li>
                <li>No compartas este código con nadie</li>
                <li>Si no solicitaste este acceso, ignora este mensaje</li>
              </ul>
            </div>
            
            <p>Si tienes problemas con el código o necesitas ayuda, contacta al administrador del sistema.</p>
            
            <p style="margin-top: 30px;">
              <strong>Equipo de Sistema de Contratos</strong><br>
              <em>Tu solución confiable para la gestión de contratos</em>
            </p>
          </div>
          
          <div class="footer">
            <p>© 2024 Sistema de Contratos. Todos los derechos reservados.</p>
            <p>Este es un mensaje automático, por favor no respondas a este correo.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getWelcomeEmailTemplate(username: string): string {
    return `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 30px 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🎉 ¡Bienvenido al Sistema de Contratos!</h1>
        </div>
        
        <div style="padding: 40px 30px;">
          <h2>Hola ${username},</h2>
          <p>Tu cuenta ha sido creada exitosamente en el <strong>Sistema de Contratos</strong>.</p>
          
          <p>Ahora puedes acceder al sistema usando tus credenciales y disfrutar de todas las funcionalidades disponibles para tu rol.</p>
          
          <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <strong>💡 Recordatorio de seguridad:</strong>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Nunca compartas tus credenciales</li>
              <li>Habilita la autenticación de dos factores</li>
              <li>Mantén tu contraseña segura</li>
            </ul>
          </div>
          
          <p>Si tienes alguna pregunta o necesitas ayuda, no dudes en contactar al administrador del sistema.</p>
          
          <p style="margin-top: 30px;">
            <strong>Equipo de Sistema de Contratos</strong><br>
            <em>Gestión eficiente, resultados excepcionales</em>
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; background: #f8fafc; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb;">
          <p>© 2024 Sistema de Contratos. Todos los derechos reservados.</p>
        </div>
      </div>
    `;
  }

  isEmailConfigured(): boolean {
    return !!this.transporter;
  }
}