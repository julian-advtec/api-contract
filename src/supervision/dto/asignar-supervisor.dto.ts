import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class AsignarSupervisorDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  supervisorIds: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  documentoIds: string[];
}