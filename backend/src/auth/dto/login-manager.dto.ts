import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

export class LoginManagerDto {
  @IsUUID()
  tenantId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
