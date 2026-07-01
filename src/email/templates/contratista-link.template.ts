// src/email/templates/contratista-link.template.ts
export interface ContratistaLinkTemplateData {
  nombre: string;
  enlace: string;
  expiraEn: Date;
  documento: string;
  empresa?: string;
}

export function generarTemplateContratistaLink(data: ContratistaLinkTemplateData): string {
  const fechaFormateada = data.expiraEn.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const empresa = data.empresa || 'Sistema de Contratos';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', -apple-system, Arial, sans-serif; 
          margin: 0; 
          padding: 20px; 
          background: #f5f7fa; 
          line-height: 1.6;
        }
        .container { 
          max-width: 600px; 
          margin: 0 auto; 
          background: #ffffff; 
          border-radius: 16px; 
          padding: 40px; 
          box-shadow: 0 4px 24px rgba(0,0,0,0.08); 
        }
        .header { 
          text-align: center; 
          margin-bottom: 30px; 
          border-bottom: 3px solid #1D4ED8; 
          padding-bottom: 24px; 
        }
        .header h1 { 
          color: #1D4ED8; 
          margin: 0; 
          font-size: 24px; 
          font-weight: 700; 
        }
        .header .subtitle { 
          color: #6B7280; 
          font-size: 14px; 
          margin-top: 8px; 
        }
        .content { color: #1F2937; }
        .content .greeting { font-size: 16px; margin-bottom: 16px; }
        .content .greeting strong { color: #1D4ED8; }
        .info-box { 
          background: #F0F4FF; 
          border-left: 4px solid #1D4ED8; 
          padding: 16px 20px; 
          margin: 20px 0; 
          border-radius: 8px; 
        }
        .info-row { 
          display: flex; 
          justify-content: space-between; 
          padding: 6px 0; 
          border-bottom: 1px solid rgba(0,0,0,0.05); 
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #6B7280; font-weight: 500; }
        .info-value { color: #1F2937; font-weight: 600; }
        .button-container { text-align: center; margin: 30px 0; }
        .button { 
          background: #1D4ED8; 
          color: #ffffff !important; 
          padding: 14px 40px; 
          text-decoration: none; 
          border-radius: 8px; 
          display: inline-block; 
          font-weight: 600; 
          font-size: 16px; 
          transition: background 0.3s; 
        }
        .button:hover { background: #2563EB; }
        .warning-box { 
          background: #FFFBEB; 
          border: 1px solid #FCD34D; 
          padding: 16px 20px; 
          border-radius: 8px; 
          margin: 20px 0; 
          font-size: 14px; 
          color: #92400E; 
        }
        .warning-box strong { color: #78350F; }
        .link-container { 
          background: #F3F4F6; 
          padding: 12px 16px; 
          border-radius: 8px; 
          margin: 12px 0; 
          word-break: break-all; 
          font-size: 13px; 
          color: #1F2937; 
        }
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #E5E7EB; 
          color: #6B7280; 
          font-size: 14px; 
          text-align: center; 
        }
        .footer .company { font-weight: 600; color: #1F2937; }
        .footer .small { font-size: 12px; color: #9CA3AF; margin-top: 8px; }
        @media (max-width: 480px) {
          .container { padding: 20px; }
          .header h1 { font-size: 20px; }
          .button { padding: 12px 24px; font-size: 14px; width: 100%; }
          .info-row { flex-direction: column; gap: 2px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📋 Complete su Información</h1>
          <div class="subtitle">${empresa}</div>
        </div>
        
        <div class="content">
          <p class="greeting">Estimado(a) <strong>${data.nombre}</strong>,</p>
          
          <p>Hemos creado un enlace seguro para que pueda <strong>actualizar su información personal</strong> en nuestro sistema.</p>

          <div class="info-box">
            <div class="info-row">
              <span class="info-label">📄 Documento</span>
              <span class="info-value">${data.documento}</span>
            </div>
            <div class="info-row">
              <span class="info-label">⏰ Válido hasta</span>
              <span class="info-value">${fechaFormateada}</span>
            </div>
          </div>

          <div class="button-container">
            <a href="${data.enlace}" class="button">
              ✏️ Completar mi información
            </a>
          </div>

          <p style="font-size: 14px; color: #6B7280; text-align: center;">
            O copie y pegue este enlace en su navegador:
          </p>
          <div class="link-container">${data.enlace}</div>

          <div class="warning-box">
            ⚠️ <strong>Importante:</strong> Este enlace es <strong>personal e intransferible</strong>.<br>
            Expirará en <strong>24 horas</strong> por razones de seguridad.
          </div>

          <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
            Si usted no solicitó este enlace, puede ignorar este mensaje.
          </p>
        </div>

        <div class="footer">
          <div class="company">${empresa}</div>
          <div class="small">Este es un mensaje automático, por favor no responder a este correo.</div>
          <div class="small">&copy; ${new Date().getFullYear()} Todos los derechos reservados.</div>
        </div>
      </div>
    </body>
    </html>
  `;
}