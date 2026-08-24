import { IsNumber, Min } from 'class-validator';

/** Manager-set asking price for a part, from the Inventory tab -- appends to pricing_history rather than editing a price column in place (see PartsService.setPrice). */
export class SetPartPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;
}
