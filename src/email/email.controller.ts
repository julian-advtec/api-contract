// src/email/email.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  // Ruta de prueba: /email/test?to=correo@ejemplo.com
  @Get('test')
  async sendTestEmail(@Query('to') to: string) {
    if (!to) {
      return { ok: false, message: 'Falta el parámetro ?to=' };
    }

    try {
      const testCode = Math.floor(100000 + Math.random() * 900000).toString();
      await this.emailService.sendTwoFactorCode(to, testCode);
      return { ok: true, message: `Correo de prueba enviado a ${to}` };
    } catch (error) {
      return {
        ok: false,
        message: 'Error enviando correo',
        error: error.message,
      };
    }
  }
}
