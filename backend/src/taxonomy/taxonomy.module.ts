import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartTaxonomy } from '../database/entities';
import { TaxonomyController } from './taxonomy.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PartTaxonomy])],
  controllers: [TaxonomyController],
})
export class TaxonomyModule {}
