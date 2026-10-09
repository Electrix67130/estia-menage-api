import { Knex } from 'knex';
import { resolveCategories, type LogementNotificationLevel } from '@/lib/notification-preferences';
import { getActiveMembership } from '@/lib/active-membership';
import type { LogementLevelOverride, NotificationPreferences, UpdatePreference } from './notification-preference.schema';

class NotificationPreferenceService {
  constructor(private readonly db: Knex) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const user = await this.db('user').where({ id: userId }).select('push_enabled', 'notification_prefs').first();
    const logements = (await this.db('logement_notification_level')
      .join('logement', 'logement.id', 'logement_notification_level.logement_id')
      .where('logement_notification_level.user_id', userId)
      .orderBy('logement.name')
      .select(
        'logement_notification_level.logement_id',
        'logement.name as logement_name',
        'logement_notification_level.level',
      )) as LogementLevelOverride[];
    return {
      ...resolveCategories(user?.notification_prefs),
      push_enabled: user?.push_enabled ?? true,
      logements,
    };
  }

  /** Une clé à la fois, en place : deux interrupteurs touchés vite ne s'écrasent pas. */
  async update(userId: string, data: UpdatePreference): Promise<void> {
    if ('push_enabled' in data) {
      await this.db('user').where({ id: userId }).update({ push_enabled: data.push_enabled, updated_at: this.db.fn.now() });
      return;
    }
    await this.db('user')
      .where({ id: userId })
      .update({
        notification_prefs: this.db.raw("jsonb_set(coalesce(notification_prefs, '{}'::jsonb), ?, ?::jsonb, true)", [
          `{${data.key}}`,
          JSON.stringify(data.enabled),
        ]),
        updated_at: this.db.fn.now(),
      });
  }

  /** Le logement fait-il partie de l'organisation active de la personne ? */
  async canAccessLogement(userId: string, logementId: string): Promise<boolean> {
    const membership = await getActiveMembership(this.db, userId);
    if (!membership) return false;
    const logement = await this.db('logement').where({ id: logementId }).select('organization_id').first();
    return logement?.organization_id === membership.organization_id;
  }

  async getLogementLevel(userId: string, logementId: string): Promise<LogementNotificationLevel> {
    const row = await this.db('logement_notification_level')
      .where({ user_id: userId, logement_id: logementId })
      .select('level')
      .first();
    return (row?.level as LogementNotificationLevel | undefined) ?? 'all';
  }

  /** « Tout » est le réglage par défaut : on le note en supprimant la ligne. */
  async setLogementLevel(userId: string, logementId: string, level: LogementNotificationLevel): Promise<void> {
    if (level === 'all') {
      await this.db('logement_notification_level').where({ user_id: userId, logement_id: logementId }).del();
      return;
    }
    await this.db('logement_notification_level')
      .insert({ user_id: userId, logement_id: logementId, level })
      .onConflict(['user_id', 'logement_id'])
      .merge({ level, updated_at: this.db.fn.now() });
  }
}

export default NotificationPreferenceService;
