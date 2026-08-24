import { IsEnum } from 'class-validator';
import { AiGrade } from '../../database/entities/ai-analysis.entity';

/** Manager-entered grade for a Part with no photo at all (see PartsService.recordManualGrade) -- e.g. an alternator inside the engine no picture ever shows. */
export class SetManualGradeDto {
  @IsEnum(AiGrade)
  grade!: AiGrade;
}
