import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AssignVehiclePhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  photoIds!: string[];

  @IsUUID()
  taxonomyId!: string;
}
