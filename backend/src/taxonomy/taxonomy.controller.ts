import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartTaxonomy } from '../database/entities';

@Controller('taxonomy')
export class TaxonomyController {
  constructor(
    @InjectRepository(PartTaxonomy)
    private readonly taxonomyRepo: Repository<PartTaxonomy>,
  ) {}

  // No RLS on part_taxonomies (shared reference data, see the entity) — any
  // authenticated role can read it, and it's small/static enough for the
  // PWA to cache the whole list for offline part selection.
  @Get()
  findAll(): Promise<PartTaxonomy[]> {
    return this.taxonomyRepo.find({ order: { category: 'ASC', name: 'ASC' } });
  }
}
