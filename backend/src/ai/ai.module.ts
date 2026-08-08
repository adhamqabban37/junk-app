import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartTaxonomy } from '../database/entities';
import { AiAnalysisProcessor } from './ai-analysis.processor';
import { AiAnalysisService } from './ai-analysis.service';
import { GeminiService } from './gemini.service';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';
import { DetectPartsController } from './detect-parts.controller';
import { DetectPartsService } from './detect-parts.service';
import { TaxonomyMatcher } from './taxonomy-matcher';

// No BullModule.registerQueue() here: @Processor/WorkerHost builds its own
// Worker directly from the root BullModule.forRootAsync connection config,
// it doesn't need a registered Queue token in this module. Registering one
// anyway (as this used to) created a second, entirely unused Queue producer
// with its own Redis connection and no error listener -- during Jest
// teardown between e2e spec files, that connection closing mid-flight threw
// an unhandled 'error' event that crashed whatever unrelated test file
// happened to be running at that moment.
@Module({
  imports: [TypeOrmModule.forFeature([PartTaxonomy])],
  controllers: [CorrectionsController, DetectPartsController],
  providers: [
    GeminiService,
    AiAnalysisService,
    AiAnalysisProcessor,
    CorrectionsService,
    DetectPartsService,
    TaxonomyMatcher,
  ],
  // Exported for VehiclesModule's POST /vehicles/:id/scan, which runs the
  // same detection pipeline against a vehicle that already exists and then
  // persists the results. Only the stateless detector is shared -- the
  // grading processor and its queue stay private to this module.
  exports: [DetectPartsService],
})
export class AiModule {}
