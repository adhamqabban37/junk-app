import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PartStatus } from '../../database/entities/part.entity';

export class ListPartsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsEnum(PartStatus, { each: true })
  status?: PartStatus[];

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
