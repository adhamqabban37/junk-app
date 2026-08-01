import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AI_ANALYSIS_QUEUE } from '../ai/ai-analysis.processor';
import { PartsController } from './parts.controller';
import { PartsService } from './parts.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_ANALYSIS_QUEUE })],
  controllers: [PartsController],
  providers: [PartsService],
})
export class PartsModule {}
