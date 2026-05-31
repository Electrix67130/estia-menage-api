import { z } from 'zod';

export const sectionTypeEnum = z.enum([
  'kitchen',
  'living_room',
  'bedroom',
  'bathroom',
  'wc',
  'exterior',
  'basement',
  'laundry',
  'general',
]);
export type SectionType = z.infer<typeof sectionTypeEnum>;

export const createSectionSchema = z.object({
  menage_id: z.string().uuid(),
  section_type: sectionTypeEnum,
  section_label: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
});

export const updateSectionSchema = z.object({
  section_label: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderSectionsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export const createItemSchema = z.object({
  section_id: z.string().uuid(),
  item_label: z.string().min(1).max(300),
  position: z.number().int().min(0).optional(),
});

export const updateItemSchema = z.object({
  item_label: z.string().min(1).max(300).optional(),
  comment: z.string().max(5000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderItemsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export const toggleItemSchema = z.object({
  validated: z.boolean(),
  comment: z.string().max(5000).optional(),
});

export type CreateSection = z.infer<typeof createSectionSchema>;
export type UpdateSection = z.infer<typeof updateSectionSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
export type ToggleItem = z.infer<typeof toggleItemSchema>;

export type MenageCheckSectionRow = {
  id: string;
  menage_id: string;
  section_type: SectionType;
  section_label: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type MenageCheckItemRow = {
  id: string;
  section_id: string;
  item_label: string;
  position: number;
  validated_at: string | null;
  validated_by: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type MenageCheckTree = (MenageCheckSectionRow & { items: MenageCheckItemRow[] })[];
