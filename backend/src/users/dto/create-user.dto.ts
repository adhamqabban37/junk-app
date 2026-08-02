import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../database/entities/user.entity';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // Owner accounts are never created through this endpoint -- deliberately
  // excluded, not just left off a UI (a manager creating a new owner would
  // be a real privilege-escalation path).
  @IsIn([UserRole.WORKER, UserRole.MANAGER])
  role!: UserRole.WORKER | UserRole.MANAGER;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(4, 8)
  pin?: string;
}
