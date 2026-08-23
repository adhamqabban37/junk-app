import { IsEnum, IsOptional } from 'class-validator';
import { VehiclePhotoSection } from '../../database/entities/vehicle-photo.entity';

/**
 * multipart/form-data body field alongside the `photo:<id>` file fields on
 * POST /vehicles/:id/photos -- see VehiclePhotoSection's doc comment for
 * why this is one optional tag per upload batch, not per photo.
 */
export class AddVehiclePhotosDto {
  @IsOptional()
  @IsEnum(VehiclePhotoSection)
  section?: VehiclePhotoSection;
}
