import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(200).optional(),
});

export const uuidParamSchema = z.object({ id: z.string().uuid() });

export type Pagination = z.infer<typeof paginationSchema>;
