import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisProcessor,
} from './ai-analysis.processor';
import { AiAnalysisService } from './ai-analysis.service';
import { GeminiService } from './gemini.service';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_ANALYSIS_QUEUE })],
  controllers: [CorrectionsController],
  providers: [
    GeminiService,
    AiAnalysisService,
    AiAnalysisProcessor,
    CorrectionsService,
  ],
})
export class AiModule {}
