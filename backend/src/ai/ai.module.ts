import { Module } from '@nestjs/common';
import { PartsModule } from '../parts/parts.module';
import { AiAnalysisProcessor } from './ai-analysis.processor';
import { AiAnalysisService } from './ai-analysis.service';
import { VehicleAnalysisProcessor } from './vehicle-analysis.processor';
import { GeminiService } from './gemini.service';
import { GradingService } from './grading.service';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';

// No BullModule.registerQueue() here: @Processor/WorkerHost builds its own
// Worker directly from the root BullModule.forRootAsync connection config,
// it doesn't need a registered Queue token in this module. Registering one
// anyway (as this used to) created a second, entirely unused Queue producer
// with its own Redis connection and no error listener -- during Jest
// teardown between e2e spec files, that connection closing mid-flight threw
// an unhandled 'error' event that crashed whatever unrelated test file
// happened to be running at that moment.
@Module({
  imports: [PartsModule],
  controllers: [CorrectionsController],
  providers: [
    GeminiService,
    GradingService,
    AiAnalysisService,
    AiAnalysisProcessor,
    VehicleAnalysisProcessor,
    CorrectionsService,
  ],
})
export class AiModule {}
