import { ArrayMinSize, ArrayUnique, IsUUID } from 'class-validator';

/** Manager-driven backstop for the AI splitting one physical part into several Parts across separate analysis runs/sections (see docs/PROGRESS.md Phase 5) -- sourcePartIds get folded into the :id target part in the route. */
export class MergePartsDto {
  @IsUUID('4', { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  sourcePartIds!: string[];
}
