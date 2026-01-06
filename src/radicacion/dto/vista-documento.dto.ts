import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class VistaDocumentoDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  numeroRadicado: string;

  @IsString()
  @IsNotEmpty()
  numeroContrato: string;

  @IsString()
  @IsNotEmpty()
  nombreContratista: string;

  @IsString()
  @IsNotEmpty()
  documentoContratista: string;

  @IsString()
  @IsNotEmpty()
  fechaInicio: string;

  @IsString()
  @IsNotEmpty()
  fechaFin: string;

  @IsString()
  @IsNotEmpty()
  estado: string;

  // ✅ 5 ARCHIVOS CON DESCRIPCIONES
  @IsString()
  @IsOptional()
  cuentaCobro?: string;

  @IsString()
  @IsOptional()
  descripcionCuentaCobro?: string;

  @IsString()
  @IsOptional()
  seguridadSocial?: string;

  @IsString()
  @IsOptional()
  descripcionSeguridadSocial?: string;

  @IsString()
  @IsOptional()
  informeActividades?: string;

  @IsString()
  @IsOptional()
  descripcionInformeActividades?: string;

  @IsString()
  @IsOptional()
  informeSatisfaccion?: string;

  @IsString()
  @IsOptional()
  descripcionInformeSatisfaccion?: string;

  @IsString()
  @IsOptional()
  informeSupervision?: string;

  @IsString()
  @IsOptional()
  descripcionInformeSupervision?: string;

  @IsString()
  @IsOptional()
  observacion?: string;

  @IsString()
  @IsNotEmpty()
  nombreRadicador: string;

  @IsString()
  @IsOptional()
  usuarioAsignadoNombre?: string;

  @IsString()
  @IsNotEmpty()
  fechaRadicacion: string;

  @IsString()
  @IsNotEmpty()
  fechaActualizacion: string;

  @IsString()
  @IsOptional()
  rutaCarpetaRadicado?: string;

  @IsString()
  @IsOptional()
  ultimoAcceso?: string;

  @IsString()
  @IsOptional()
  ultimoUsuario?: string;

  @IsString()
  @IsOptional()
  comentarios?: string;

  @IsString()
  @IsOptional()
  correcciones?: string;

  @IsString()
  @IsOptional()
  fechaLimiteRevision?: string;

  @IsString()
  @IsOptional()
  tokenPublico?: string;

  @IsBoolean()
  @IsOptional()
  tokenActivo?: boolean;

  @IsString()
  @IsOptional()
  tokenExpiraEn?: string;

  @IsString()
  @IsOptional()
  contratistaId?: string;
}