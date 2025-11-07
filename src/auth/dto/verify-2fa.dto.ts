import { IsString, Length } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  userId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}