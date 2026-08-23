import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PartStatus } from '../../database/entities/part.entity';

export class ListPartsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsEnum(PartStatus, { each: true })
  status?: PartStatus[];

  /** Scopes results to one vehicle -- powers the vehicle detail screen's Parts section (grade/approve per part, without a second, duplicated query shape). */
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize: number = 50;
}
