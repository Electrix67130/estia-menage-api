import { z } from 'zod';
import {
  LOGEMENT_NOTIFICATION_LEVELS,
  NOTIFICATION_CATEGORIES,
  type LogementNotificationLevel,
  type NotificationCategory,
} from '@/lib/notification-preferences';

/**
 * Une modification à la fois : une catégorie (`key`, nom historique gardé pour
 * les apps déjà installées) ou l'interrupteur général.
 */
export const updatePreferenceSchema = z.union([
  z.object({ key: z.enum(NOTIFICATION_CATEGORIES), enabled: z.boolean() }),
  z.object({ push_enabled: z.boolean() }),
]);

/** Le réglage d'un logement : tout, l'important, ou rien. */
export const logementLevelSchema = z.object({
  level: z.enum(LOGEMENT_NOTIFICATION_LEVELS),
});

export const logementParamsSchema = z.object({
  logementId: z.string().uuid(),
});

export type UpdatePreference = z.infer<typeof updatePreferenceSchema>;

/** Un logement dont le réglage n'est pas « tout ». */
export type LogementLevelOverride = {
  logement_id: string;
  logement_name: string;
  level: Exclude<LogementNotificationLevel, 'all'>;
};

/**
 * Les catégories restent à plat à la racine (forme lue par les apps déjà
 * installées), à côté de l'interrupteur général et des logements réglés.
 */
export type NotificationPreferences = Record<NotificationCategory, boolean> & {
  push_enabled: boolean;
  logements: LogementLevelOverride[];
};
