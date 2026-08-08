import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AI_ANALYSIS_QUEUE } from '../ai/ai-analysis.processor';
import { AiModule } from '../ai/ai.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [BullModule.registerQueue({ name: AI_ANALYSIS_QUEUE }), AiModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
