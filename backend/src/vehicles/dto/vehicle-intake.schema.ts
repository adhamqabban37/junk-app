import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// Mirrors frontend/src/lib/offline/types.ts's DecodedVehicle.
const DecodedVehicleSchema = z
  .object({
    make: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().nullable(),
    trim: z.string().nullable(),
    raw: z.record(z.unknown()),
  })
  .nullable();

function parseJson(raw: string, fieldName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestException(`${fieldName} is not valid JSON`);
  }
}

export function parseDecoded(
  raw: string,
): z.infer<typeof DecodedVehicleSchema> {
  const result = DecodedVehicleSchema.safeParse(parseJson(raw, 'decoded'));
  if (!result.success) {
    throw new BadRequestException('decoded does not match the expected shape');
  }
  return result.data;
}
