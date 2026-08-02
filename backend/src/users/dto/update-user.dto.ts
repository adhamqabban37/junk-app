import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../database/entities/user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn([UserRole.WORKER, UserRole.MANAGER])
  role?: UserRole.WORKER | UserRole.MANAGER;
}
