import { IsUUID } from 'class-validator';

export class CreateManualPartDto {
  @IsUUID()
  taxonomyId!: string;
}
