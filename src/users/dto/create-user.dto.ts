import { IsEmail, IsString, IsEnum, IsBoolean, IsOptional, MinLength, Matches } from 'class-validator';
import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username solo puede contener letras, números y guiones bajos' })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, { 
    message: 'La contraseña debe contener al menos una mayúscula, una minúscula y un número' 
  })
  password: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}