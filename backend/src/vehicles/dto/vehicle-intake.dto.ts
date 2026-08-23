import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { VehiclePhotoSection } from '../../database/entities/vehicle-photo.entity';

/**
 * multipart/form-data body fields sent by `buildIntakeFormData()`
 * (frontend/src/lib/offline/sync.ts). `decoded` arrives as a JSON-encoded
 * string -- multer/multipart has no concept of nested objects -- and is
 * parsed+validated separately, see `vehicle-intake.schema.ts`. Actual
 * photos arrive as separate `photo:<id>` file fields, read from
 * `req.files` rather than this DTO -- see VehiclesController.intake().
 */
export class VehicleIntakeDto {
  @IsString()
  @IsNotEmpty()
  draftId!: string;

  // The real mobile UI (vin-page-client.tsx) requires a valid 17-char VIN
  // before a draft can ever reach the vehicle-info step, so a request that
  // doesn't have one is malformed/hand-crafted, not a real sync -- reject
  // it rather than silently coercing a placeholder VIN into the database.
  @IsString()
  @Length(17, 17)
  vin!: string;

  @IsOptional()
  @IsString()
  vinEntryMethod?: string;

  @IsString()
  decoded!: string;

  // Applies to every photo in this batch -- optional, never required (see
  // VehiclePhotoSection's own doc comment for why this stays batch-level).
  @IsOptional()
  @IsEnum(VehiclePhotoSection)
  section?: VehiclePhotoSection;
}
