import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Manager-entered facts about a vehicle that no automated source can supply:
 * what it cost, what the odometer read, and where it is parked.
 *
 * Every field is optional because this is a partial update -- a manager who
 * only knows the acquisition cost today should be able to save it without
 * being forced to invent an odometer reading. `null` is accepted as an
 * explicit "clear this", distinct from omitting the key.
 *
 * Deliberately does NOT accept `stockNumber` or `vin`. Stock numbers are
 * issued by the system and become permanent the moment they are printed on
 * a label or quoted to a buyer; letting them be edited through a general
 * update endpoint is how two vehicles end up sharing one.
 */
export class UpdateVehicleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerMiles?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  acquisitionCost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  acquisitionSource?: string | null;

  @IsOptional()
  @IsDateString()
  acquisitionDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  locationCode?: string | null;
}
