import { Knex } from 'knex';
import {
  ExternalCalendarRow,
  CreateExternalCalendar,
  UpdateExternalCalendar,
  SyncResult,
} from './logement-external-calendar.schema';
import { parseIcal, isBlockedEvent, IcalEvent } from './ical-parser';
import { generateChecklistForMenage } from '@/modules/menage-check/menage-check.service';
import { LogementRow } from '@/modules/logement/logement.schema';
import { notifyMenageAvailable, notifyMenageCancelled } from '@/lib/push';

class LogementExternalCalendarService {
  constructor(private db: Knex) {}

  async findByLogement(logementId: string): Promise<ExternalCalendarRow[]> {
    return this.db('logement_external_calendar')
      .where({ logement_id: logementId })
      .orderBy('created_at', 'asc') as Promise<ExternalCalendarRow[]>;
  }

  async findById(id: string): Promise<ExternalCalendarRow | undefined> {
    return this.db('logement_external_calendar')
      .where({ id })
      .first() as Promise<ExternalCalendarRow | undefined>;
  }

  async findAllEnabled(): Promise<ExternalCalendarRow[]> {
    return this.db('logement_external_calendar')
      .where({ enabled: true })
      .orderBy('last_synced_at', 'asc') as Promise<ExternalCalendarRow[]>;
  }

  async create(data: CreateExternalCalendar): Promise<ExternalCalendarRow> {
    const [row] = (await this.db('logement_external_calendar')
      .insert(data)
      .returning('*')) as ExternalCalendarRow[];
    return row;
  }

  async update(id: string, data: UpdateExternalCalendar): Promise<ExternalCalendarRow | undefined> {
    const [row] = (await this.db('logement_external_calendar')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning('*')) as ExternalCalendarRow[];
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db('logement_external_calendar').where({ id }).del();
  }

  /**
   * Fetch + parse + upsert pour UN calendrier.
   *
   * Stratégie :
   *  - Pour chaque VEVENT, on upsert un ménage avec `(external_source, external_event_uid)`
   *    comme clé d'unicité. Le ménage est programmé sur DTEND (= check-out).
   *  - Si un ménage existait en BDD avec un UID qui n'est plus dans le feed,
   *    on l'annule (status='annule') au lieu de le supprimer — préserve
   *    l'historique. Sauf si le ménage est déjà passé en `valide`.
   */
  async syncCalendar(cal: ExternalCalendarRow): Promise<SyncResult> {
    const result: SyncResult = {
      fetched_events: 0,
      created_menages: 0,
      updated_menages: 0,
      cancelled_menages: 0,
    };

    let text: string;
    try {
      const response = await fetch(cal.url, {
        headers: { Accept: 'text/calendar, text/plain, */*' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      text = await response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch failed';
      await this.markSync(cal.id, msg);
      result.error = msg;
      return result;
    }

    let events: IcalEvent[];
    try {
      events = parseIcal(text);
      // Filtre les CANCELLED si présents (RFC 5545 §3.8.1.11).
      events = events.filter((e) => (e.status ?? '').toUpperCase() !== 'CANCELLED');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'parse failed';
      await this.markSync(cal.id, msg);
      result.error = msg;
      return result;
    }

    result.fetched_events = events.length;

    // Logement parent pour récupérer org_id + defaults.
    const logement = (await this.db('logement')
      .where({ id: cal.logement_id })
      .first()) as LogementRow | undefined;
    if (!logement) {
      await this.markSync(cal.id, 'logement not found');
      result.error = 'logement not found';
      return result;
    }

    // Ménages déjà connus pour CE calendrier précis (et pas seulement le
    // provider) : sinon deux calendriers du même provider sur le même logement
    // s'annuleraient mutuellement.
    const externalSource = `cal_${cal.provider}`;
    const existing = (await this.db('menage')
      .where({ external_calendar_id: cal.id })
      .select('id', 'external_event_uid', 'prestation_type', 'date_prevue', 'status', 'date_locked', 'next_checkin_at', 'stay_nights')) as Array<{
      id: string;
      external_event_uid: string;
      prestation_type: 'menage' | 'check_in' | 'check_out';
      date_prevue: string | Date;
      status: string;
      date_locked: boolean;
      next_checkin_at: string | Date | null;
      stay_nights: number | null;
    }>;
    // Une réservation (UID) peut désormais matérialiser jusqu'à 3 prestations
    // (ménage + check-in + check-out) → clé d'unicité composite `uid:type`.
    const keyOf = (uid: string, type: string): string => `${uid}:${type}`;
    const existingByKey = new Map(
      existing.map((m) => [keyOf(m.external_event_uid, m.prestation_type), m]),
    );
    const seenKeys = new Set<string>();
    const createdMenageIds: string[] = [];
    const cancelledMenageIds: string[] = [];

    const defaultDuration = logement.default_duration_min ?? null;
    const defaultClientPrice = numOrNull(logement.default_client_price_ht);
    const defaultClientVat = numOrNull(logement.default_client_vat_rate);
    const defaultProviderPrice = numOrNull(logement.default_provider_price);
    const defaultLaundryIncluded = !!logement.default_laundry_included;
    const defaultLaundryClient = numOrNull(logement.default_laundry_client_price_ht);
    const defaultLaundryProvider = numOrNull(logement.default_laundry_provider_price);

    // Prochain check-in : pour un checkout donné, la plus petite date d'arrivée
    // (start) >= ce checkout parmi les réservations de ce calendrier. Pour une
    // rotation le jour même, next_checkin == date du ménage.
    const checkInDates = events
      .filter((e) => !isBlockedEvent(e))
      .map((e) => e.start_date)
      .sort();
    const nextCheckinAfter = (checkout: string): string | null =>
      checkInDates.find((s) => s >= checkout) ?? null;

    // Nb de nuits du séjour (checkout − checkin) — null si incohérent.
    const nightsOf = (start: string, end: string): number | null => {
      const a = new Date(`${start}T00:00:00Z`).getTime();
      const b = new Date(`${end}T00:00:00Z`).getTime();
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const n = Math.round((b - a) / 86_400_000);
      return n > 0 ? n : null;
    };

    for (const ev of events) {
      // Les blocages de dates (date fermée par l'hôte / résa importée d'un
      // autre site) ne sont pas de vraies réservations → pas de ménage. On ne
      // les marque pas "vus" : si un ménage existait pour cet UID (ancienne
      // résa devenue blocage), il sera annulé par la boucle CANCEL plus bas.
      if (isBlockedEvent(ev)) continue;

      const nc = nextCheckinAfter(ev.end_date);
      const nights = nightsOf(ev.start_date, ev.end_date);

      // Prestations à matérialiser pour cette réservation. Le ménage (sur le
      // check-out = end_date) est toujours créé, comme historiquement. Les
      // check-in (arrivée = start_date) / check-out (départ = end_date) ne sont
      // créés que si le logement les active. `next_checkin_at` / `stay_nights`
      // ne concernent que le ménage (planification du nettoyage).
      const targets: Array<{
        type: 'menage' | 'check_in' | 'check_out';
        date: string;
        nc: string | null;
        nights: number | null;
      }> = [{ type: 'menage', date: ev.end_date, nc, nights }];
      if (logement.enable_check_in)
        targets.push({ type: 'check_in', date: ev.start_date, nc: null, nights: null });
      if (logement.enable_check_out)
        targets.push({ type: 'check_out', date: ev.end_date, nc: null, nights: null });

      for (const t of targets) {
        const key = keyOf(ev.uid, t.type);
        seenKeys.add(key);
        const isMenageType = t.type === 'menage';
        const prev = existingByKey.get(key);
        if (prev) {
          // UPDATE — si la date a changé OU si la prestation avait été annulée,
          // on la ré-active à la nouvelle date. `date_prevue` peut revenir en
          // `Date` (colonne `date` parsée par node-pg) → normalisation locale.
          const dateChanged = ymd(prev.date_prevue) !== t.date;
          const wasCancelled = prev.status === 'annule';
          const ncChanged = (prev.next_checkin_at ? ymd(prev.next_checkin_at) : null) !== t.nc;
          const nightsChanged = (prev.stay_nights ?? null) !== t.nights;
          if (dateChanged || wasCancelled || ncChanged || nightsChanged) {
            // Si la date a été verrouillée manuellement (admin a approuvé un
            // reschedule ou modifié la date à la main), on garde la date
            // locale et on se contente de ré-activer une prestation annulée.
            const update: Record<string, unknown> = { updated_at: new Date() };
            if (!prev.date_locked && dateChanged) update.date_prevue = t.date;
            if (wasCancelled) update.status = 'a_venir';
            if (ncChanged) update.next_checkin_at = t.nc;
            if (nightsChanged) update.stay_nights = t.nights;
            if (Object.keys(update).length > 1) {
              await this.db('menage').where({ id: prev.id }).update(update);
              result.updated_menages++;
            }
          }
          continue;
        }

        // CREATE — les montants (prix, blanchisserie) ne sont copiés que pour le
        // ménage ; check-in/check-out démarrent sans tarif (l'admin ajuste).
        const insertData = {
          logement_id: cal.logement_id,
          organization_id: logement.organization_id,
          created_by: logement.created_by,
          prestataire_user_id: null,
          prestation_type: t.type,
          status: 'a_venir' as const,
          date_prevue: t.date,
          next_checkin_at: t.nc,
          stay_nights: t.nights,
          horaire_prevu: logement.default_horaire_debut ?? null,
          horaire_fin_prevu: logement.default_horaire_fin ?? null,
          duree_estimee_min: isMenageType ? defaultDuration : null,
          client_price_ht: isMenageType ? defaultClientPrice : null,
          client_vat_rate: isMenageType ? defaultClientVat : null,
          provider_price: isMenageType ? defaultProviderPrice : null,
          laundry_included: isMenageType ? defaultLaundryIncluded : false,
          laundry_client_price_ht:
            isMenageType && defaultLaundryIncluded ? defaultLaundryClient : null,
          laundry_provider_price:
            isMenageType && defaultLaundryIncluded ? defaultLaundryProvider : null,
          notes_intervention: ev.summary ? `Auto (${cal.provider}) : ${ev.summary}` : `Auto (${cal.provider})`,
          external_source: externalSource,
          external_event_uid: ev.uid,
          external_calendar_id: cal.id,
        };

        await this.db.transaction(async (trx) => {
          const [menage] = (await trx('menage').insert(insertData).returning('*')) as Array<{
            id: string;
          }>;
          await generateChecklistForMenage(trx, menage.id, logement);
          createdMenageIds.push(menage.id);
        });
        result.created_menages++;
      }
    }

    // CANCEL — prestations connues mais plus dans le feed (booking annulée) OU
    // dont le type n'est plus activé sur le logement (toggle check-in/out coupé).
    for (const prev of existing) {
      if (seenKeys.has(keyOf(prev.external_event_uid, prev.prestation_type))) continue;
      if (prev.status === 'valide' || prev.status === 'annule' || prev.status === 'termine') continue;
      await this.db('menage')
        .where({ id: prev.id })
        .update({ status: 'annule', updated_at: new Date() });
      cancelledMenageIds.push(prev.id);
      result.cancelled_menages++;
    }

    await this.markSync(cal.id, null);

    // Notifications push (fire-and-forget) — après la sync, hors transaction.
    // Création iCal = ménage non assigné → "disponible" aux prestataires du logement.
    for (const menageId of createdMenageIds) {
      notifyMenageAvailable(this.db, menageId).catch(() => {});
    }
    // Annulation iCal → prévenir les prestataires assignés (s'il y en a).
    for (const menageId of cancelledMenageIds) {
      this.db('menage_prestataire')
        .where({ menage_id: menageId })
        .select('user_id')
        .then((rows: { user_id: string }[]) =>
          notifyMenageCancelled(this.db, menageId, rows.map((r) => r.user_id)),
        )
        .catch(() => {});
    }

    return result;
  }

  private async markSync(calId: string, error: string | null): Promise<void> {
    await this.db('logement_external_calendar')
      .where({ id: calId })
      .update({
        last_synced_at: new Date(),
        last_error: error,
        updated_at: new Date(),
      });
  }
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * Normalise une `date_prevue` en `YYYY-MM-DD`. node-pg parse les colonnes `date`
 * en objet `Date` (minuit local) → on extrait l'année/mois/jour locaux pour
 * éviter tout décalage de fuseau (toISOString décalerait d'un jour).
 */
function ymd(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export default LogementExternalCalendarService;
