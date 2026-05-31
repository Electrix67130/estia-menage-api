import { z } from 'zod';

/** Item d'un modèle (dans le payload arbre). */
export const templateItemInputSchema = z.object({
  label: z.string().min(1).max(300),
  required: z.boolean().optional().default(true),
});

/** Section d'un modèle avec ses items. */
export const templateSectionInputSchema = z.object({
  label: z.string().min(1).max(200),
  items: z.array(templateItemInputSchema).default([]),
});

/**
 * Création / mise à jour d'un modèle : on envoie l'arbre complet. Côté service,
 * un update remplace intégralement les sections+items (plus simple qu'un CRUD
 * granulaire pour un éditeur).
 */
export const createChecklistTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  sections: z.array(templateSectionInputSchema).default([]),
});

export const updateChecklistTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sections: z.array(templateSectionInputSchema).optional(),
});

export const applyTemplateSchema = z.object({
  template_id: z.string().uuid(),
});

export type CreateChecklistTemplate = z.infer<typeof createChecklistTemplateSchema>;
export type UpdateChecklistTemplate = z.infer<typeof updateChecklistTemplateSchema>;
export type TemplateSectionInput = z.infer<typeof templateSectionInputSchema>;

export type ChecklistTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ChecklistTemplateSectionRow = {
  id: string;
  template_id: string;
  label: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type ChecklistTemplateItemRow = {
  id: string;
  section_id: string;
  label: string;
  position: number;
  required: boolean;
  created_at: string;
  updated_at: string;
};

export type ChecklistTemplateTree = ChecklistTemplateRow & {
  sections: (ChecklistTemplateSectionRow & { items: ChecklistTemplateItemRow[] })[];
};
