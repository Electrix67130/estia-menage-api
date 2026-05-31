/**
 * Geocoding via api-adresse.data.gouv.fr (BAN — Base Adresse Nationale).
 * Service public gratuit, sans clé API, optimisé pour la France.
 *
 * Usage : récupérer lat/lng d'un logement à partir de son adresse texte
 * pour permettre l'affichage sur la carte.
 */

interface BanFeature {
  geometry: { coordinates: [number, number] }; // [lng, lat] (GeoJSON)
  properties: { score: number; label: string };
}

interface BanResponse {
  features: BanFeature[];
}

export interface GeocodeInput {
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  matched_label: string;
  score: number;
}

const ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';

/**
 * Compose un query string et appelle BAN.
 * Renvoie null si rien d'utile (pas d'adresse, requête échoue, aucun résultat,
 * ou score trop bas pour être fiable).
 */
export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const parts = [input.address, input.postal_code, input.city].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  );
  const q = parts.join(' ').trim();
  if (q.length < 3) return null;

  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&limit=1&autocomplete=0`;
    const res = await fetch(url, {
      // Timeout de 3s : ne bloque jamais une création de logement si BAN est down.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as BanResponse;
    const feat = data.features?.[0];
    if (!feat) return null;
    // Score BAN ∈ [0, 1] ; on rejette les correspondances très douteuses
    if (feat.properties.score < 0.4) return null;
    const [lng, lat] = feat.geometry.coordinates;
    return {
      latitude: lat,
      longitude: lng,
      matched_label: feat.properties.label,
      score: feat.properties.score,
    };
  } catch {
    return null;
  }
}
