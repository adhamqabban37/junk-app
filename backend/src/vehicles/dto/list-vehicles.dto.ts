import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CrushStatus } from '../../database/entities/vehicle.entity';

export class ListVehiclesDto {
  @IsOptional()
  @IsEnum(CrushStatus)
  crushStatus?: CrushStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}
