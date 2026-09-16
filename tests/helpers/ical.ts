import { vi } from 'vitest';

/**
 * Sert un flux iCal factice à la place du réseau.
 *
 * La synchronisation va chercher l'URL du calendrier par `fetch` ; on
 * l'intercepte pour contrôler le contenu, et on absorbe au passage les envois
 * vers Expo que la synchro déclenche (ménage disponible, ménage annulé) — sans
 * quoi chaque test tenterait de joindre exp.host.
 */
export interface FluxSimule {
  /** Remplace le contenu servi pour la prochaine synchronisation. */
  servir: (contenu: string) => void;
  /** Force une réponse en erreur, pour vérifier le traitement des pannes. */
  echouer: (statut: number) => void;
  restore: () => void;
}

export function simulerFluxIcal(url: string, contenuInitial: string): FluxSimule {
  const original = globalThis.fetch;
  let contenu = contenuInitial;
  let statut = 200;

  type ParamsFetch = Parameters<typeof fetch>;
  globalThis.fetch = vi.fn(async (cible: ParamsFetch[0], init?: ParamsFetch[1]) => {
    const adresse = String(cible);
    if (adresse === url) {
      return new Response(statut === 200 ? contenu : 'erreur', {
        status: statut,
        headers: { 'content-type': 'text/calendar' },
      });
    }
    if (adresse.includes('exp.host')) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(cible, init);
  }) as typeof fetch;

  return {
    servir: (nouveau: string) => {
      contenu = nouveau;
      statut = 200;
    },
    echouer: (code: number) => {
      statut = code;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Enveloppe VCALENDAR autour d'événements bruts. */
export function calendrier(...evenements: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evenements, 'END:VCALENDAR'].join('\n');
}

/** Un VEVENT de réservation : arrivée, départ, et UID facultatif. */
export function reservation(options: {
  debut: string;
  fin: string;
  uid?: string;
  summary?: string;
  description?: string;
}): string {
  const lignes = [
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${options.debut.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${options.fin.replace(/-/g, '')}`,
  ];
  if (options.uid) lignes.push(`UID:${options.uid}`);
  if (options.summary) lignes.push(`SUMMARY:${options.summary}`);
  if (options.description) lignes.push(`DESCRIPTION:${options.description}`);
  lignes.push('END:VEVENT');
  return lignes.join('\n');
}
