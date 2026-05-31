/**
 * Parseur iCal minimal — assez pour Airbnb / Booking / Vrbo.
 *
 * Format RFC 5545 simplifié :
 *  - Lignes pliées (continuation = espace en début de ligne suivante)
 *  - key[:params...]:value
 *  - Bloc VEVENT entre BEGIN:VEVENT et END:VEVENT
 *  - DTSTART / DTEND peuvent être DATE (YYYYMMDD) ou DATETIME (YYYYMMDDTHHMMSSZ)
 *
 * On évite une dépendance externe (`node-ical`) car ce qu'on traite est
 * vraiment trivial et bien spécifié.
 */

export interface IcalEvent {
  uid: string;
  /** Check-in (DTSTART). Format YYYY-MM-DD. */
  start_date: string;
  /** Check-out (DTEND), au format YYYY-MM-DD. C'est la date du ménage à programmer. */
  end_date: string;
  summary?: string;
  description?: string;
  status?: string;
}

/**
 * Distingue une vraie réservation d'un simple blocage de dates (date fermée par
 * l'hôte, ou réservation importée d'un autre site). Airbnb encode les deux avec
 * `SUMMARY: Airbnb (Not available)` ; seule une vraie réservation porte une URL
 * de réservation dans la `DESCRIPTION`. Les blocages n'ont pas cette URL.
 *
 * Règle : on considère comme blocage (→ pas de ménage) un event dont le SUMMARY
 * indique l'indisponibilité ET qui n'a pas d'URL de réservation. Les autres
 * (réservations, autres providers) génèrent un ménage.
 */
export function isBlockedEvent(ev: IcalEvent): boolean {
  const summary = (ev.summary ?? '').toLowerCase();
  const description = (ev.description ?? '').toLowerCase();
  const looksUnavailable = summary.includes('not available') || summary.includes('blocked') || summary.includes('indisponible');
  const hasReservationUrl =
    description.includes('/reservations/') || description.includes('reservation url') || description.includes('/details/');
  return looksUnavailable && !hasReservationUrl;
}

/**
 * Plie/déplie un iCal text en lignes logiques (RFC 5545 §3.1).
 * Une ligne pliée commence par espace ou tab et continue la précédente.
 */
function unfoldLines(text: string): string[] {
  // Normalise les fins de ligne (Airbnb mixe parfois \r\n et \n).
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const l of raw) {
    if (l.length === 0) continue;
    if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += l.slice(1);
    } else {
      lines.push(l);
    }
  }
  return lines;
}

/**
 * Parse une valeur de date iCal en YYYY-MM-DD.
 * - "20260524" (DATE) → "2026-05-24"
 * - "20260524T140000Z" (UTC DATETIME) → "2026-05-24"
 */
function parseDate(value: string): string | null {
  // Strip any TZID params déjà filtrés en amont — value est juste le payload.
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function parseIcal(text: string): IcalEvent[] {
  const lines = unfoldLines(text);
  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current && current.uid && current.start_date && current.end_date) {
        events.push(current as IcalEvent);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    // Sépare la clé (qui peut avoir des params après `;`) de la valeur.
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const fullKey = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const keyName = fullKey.split(';')[0].toUpperCase();

    switch (keyName) {
      case 'UID':
        current.uid = value;
        break;
      case 'DTSTART': {
        const d = parseDate(value);
        if (d) current.start_date = d;
        break;
      }
      case 'DTEND': {
        const d = parseDate(value);
        if (d) current.end_date = d;
        break;
      }
      case 'SUMMARY':
        current.summary = value;
        break;
      case 'DESCRIPTION':
        current.description = value;
        break;
      case 'STATUS':
        current.status = value;
        break;
    }
  }

  return events;
}
