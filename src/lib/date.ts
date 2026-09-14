/**
 * Normalisation des dates échangées avec PostgreSQL.
 *
 * Une colonne DATE revient de node-pg en objet `Date` positionné à **minuit
 * local**. `toISOString().slice(0, 10)` la rend donc en UTC et recule d'un jour
 * dès qu'on est à l'est de Greenwich : « 2026-07-01 » stocké devient
 * « 2026-06-30 » depuis Paris en été. Toute comparaison de jour doit passer par
 * ici.
 */
export function toYmd(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const mois = String(value.getMonth() + 1).padStart(2, '0');
    const jour = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${mois}-${jour}`;
  }
  return String(value).slice(0, 10);
}

/** Le jour courant en heure locale, au même format que `toYmd`. */
export function todayYmd(): string {
  return toYmd(new Date()) as string;
}

/**
 * Horaire au format HH:MM. La colonne TIME rend « 09:00:00 » alors qu'un client
 * envoie « 09:00 » : sans troncature, les deux paraissent toujours différents.
 */
export function toHhmm(value: string | null | undefined): string | null {
  if (value == null) return null;
  return String(value).slice(0, 5);
}
