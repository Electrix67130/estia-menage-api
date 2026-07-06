import { z } from 'zod';

// Section de template
export const createTemplateSectionSchema = z.object({
  logement_id: z.string().uuid(),
  logement_room_id: z.string().uuid().optional(),
  label: z.string().min(1).max(200),
  // Icône emoji optionnelle (null = aucune).
  icon: z.string().max(16).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const updateTemplateSectionSchema = z.object({
  logement_room_id: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderTemplateSectionsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

// Item de template
export const createTemplateItemSchema = z.object({
  section_id: z.string().uuid(),
  label: z.string().min(1).max(300),
  position: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
});

export const updateTemplateItemSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  position: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
});

export const reorderTemplateItemsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export type CreateTemplateSection = z.infer<typeof createTemplateSectionSchema>;
export type UpdateTemplateSection = z.infer<typeof updateTemplateSectionSchema>;
export type CreateTemplateItem = z.infer<typeof createTemplateItemSchema>;
export type UpdateTemplateItem = z.infer<typeof updateTemplateItemSchema>;

export type LogementCheckTemplateSectionRow = {
  id: string;
  logement_id: string;
  logement_room_id: string | null;
  label: string;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type LogementCheckTemplateItemRow = {
  id: string;
  section_id: string;
  label: string;
  position: number;
  required: boolean;
  created_at: string;
  updated_at: string;
};

export type LogementCheckTemplateTree = (LogementCheckTemplateSectionRow & {
  items: LogementCheckTemplateItemRow[];
})[];
