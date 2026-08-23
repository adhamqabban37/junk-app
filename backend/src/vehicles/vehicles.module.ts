import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { VEHICLE_ANALYSIS_QUEUE } from '../ai/vehicle-analysis.processor';
import { PartsModule } from '../parts/parts.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [
    PartsModule,
    BullModule.registerQueue({ name: VEHICLE_ANALYSIS_QUEUE }),
  ],
  controllers: [VehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
