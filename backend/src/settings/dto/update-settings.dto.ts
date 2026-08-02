import { IsNumber, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  aiConfidenceThreshold!: number;
}
