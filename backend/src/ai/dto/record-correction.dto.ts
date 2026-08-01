import { IsString, MinLength } from 'class-validator';

export class RecordCorrectionDto {
  @IsString()
  @MinLength(1)
  field!: string;

  @IsString()
  @MinLength(1)
  correctedValue!: string;
}
