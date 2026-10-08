/**
 * Geocoding d'un logement sur la base d'adresses officielle de son pays :
 *   - France     : api-adresse.data.gouv.fr (BAN — Base Adresse Nationale)
 *   - Suisse     : api3.geo.admin.ch SearchServer (adresses des bâtiments)
 *   - Luxembourg : apiv3.geoportail.lu geocode
 *   - Belgique   : photon.komoot.io (OpenStreetMap ; pas de base nationale unique)
 * Services publics gratuits, sans clé API.
 *
 * Le pays se déduit du code postal (aucune colonne pays sur le logement) :
 * 5 chiffres → France, « L-1234 » → Luxembourg, 4 chiffres → Suisse, puis
 * Luxembourg, puis Belgique. Le résultat étranger doit porter le même code postal : sans
 * cela, une adresse suisse finirait sur une commune française homonyme.
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

interface ChSearchResponse {
  results: { attrs: { label: string; detail: string; lat: number; lon: number } }[];
}

interface LuGeocodeResponse {
  results: {
    accuracy: number;
    ratio: number;
    address: string;
    geomlonlat: { coordinates: [number, number] };
    AddressDetails: { zip: string | null };
  }[];
}

interface PhotonResponse {
  features: {
    geometry: { coordinates: [number, number] };
    properties: { countrycode?: string; postcode?: string; name?: string; street?: string; housenumber?: string; city?: string };
  }[];
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

export type GeocodeCountry = 'FR' | 'CH' | 'LU' | 'BE';

const BAN_ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';
const CH_ENDPOINT = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const LU_ENDPOINT = 'https://apiv3.geoportail.lu/geocode/search';
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
/** Rectangle englobant la Belgique. */
const BE_BBOX = '2.5,49.45,6.45,51.55';

/** Pays candidats, dans l'ordre d'essai, d'après la forme du code postal. */
export function candidateCountries(postalCode?: string | null): GeocodeCountry[] {
  const cp = (postalCode ?? '').trim();
  if (/^L-?\d{4}$/i.test(cp)) return ['LU'];
  if (/^\d{4}$/.test(cp)) return ['CH', 'LU', 'BE'];
  return ['FR'];
}

/** Code postal sans préfixe pays (« L-1610 » → « 1610 »). */
export function bareZip(postalCode?: string | null): string {
  return (postalCode ?? '').trim().replace(/^L-?/i, '');
}

const clean = (s?: string | null): string | null =>
  typeof s === 'string' && s.trim().length > 0 ? s.trim() : null;

/** Timeout de 3s : ne bloque jamais une création de logement si un service est down. */
async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function geocodeFr(q: string): Promise<GeocodeResult | null> {
  const data = await getJson<BanResponse>(`${BAN_ENDPOINT}?q=${encodeURIComponent(q)}&limit=1&autocomplete=0`);
  const feat = data?.features?.[0];
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
}

const plainWords = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * La ville saisie figure-t-elle dans le `detail` suisse ? Il est translittéré à
 * l'allemande (« zuerich » pour Zürich), d'où la seconde variante.
 */
export function chDetailMatchesCity(detail: string, city: string | null): boolean {
  if (!city) return true;
  const have = new Set(plainWords(detail));
  const germanic = city.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue');
  return [city, germanic].some((variant) => plainWords(variant).every((w) => have.has(w)));
}

async function geocodeCh(q: string, zip: string, city: string | null): Promise<GeocodeResult | null> {
  const data = await getJson<ChSearchResponse>(
    `${CH_ENDPOINT}?type=locations&origins=address&sr=4326&limit=5&searchText=${encodeURIComponent(q)}`,
  );
  // `detail` = « rue du rhone 12 1204 geneve 6621 geneve ch ge ». La ville est exigée en plus
  // du code postal : 1000 est à la fois Lausanne et Bruxelles.
  const hit = data?.results?.find(
    (r) => ` ${r.attrs.detail} `.includes(` ${zip} `) && chDetailMatchesCity(r.attrs.detail, city),
  );
  if (!hit) return null;
  return {
    latitude: hit.attrs.lat,
    longitude: hit.attrs.lon,
    matched_label: hit.attrs.label.replace(/<[^>]+>/g, ''),
    score: 1,
  };
}

async function geocodeLu(q: string, zip: string): Promise<GeocodeResult | null> {
  const data = await getJson<LuGeocodeResponse>(`${LU_ENDPOINT}?queryString=${encodeURIComponent(q)}`);
  // accuracy 6 = rue, 8 = bâtiment ; en dessous, seule la localité a été reconnue.
  const hit = data?.results?.find((r) => r.accuracy >= 6 && r.AddressDetails.zip === zip);
  if (!hit) return null;
  const [lng, lat] = hit.geomlonlat.coordinates;
  return { latitude: lat, longitude: lng, matched_label: hit.address.trim(), score: hit.ratio };
}

async function geocodeBe(q: string, zip: string): Promise<GeocodeResult | null> {
  const data = await getJson<PhotonResponse>(
    `${PHOTON_ENDPOINT}?layer=house&layer=street&lang=fr&limit=5&bbox=${BE_BBOX}&q=${encodeURIComponent(q)}`,
  );
  const hit = data?.features?.find((f) => f.properties.countrycode === 'BE' && f.properties.postcode === zip);
  if (!hit) return null;
  const p = hit.properties;
  const [lng, lat] = hit.geometry.coordinates;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : p.name;
  return {
    latitude: lat,
    longitude: lng,
    matched_label: [street, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    // OSM ne donne pas de score ; la correspondance du code postal tient lieu de garde-fou.
    score: 1,
  };
}

const GEOCODERS: Record<
  GeocodeCountry,
  (q: string, zip: string, city: string | null) => Promise<GeocodeResult | null>
> = {
  FR: (q) => geocodeFr(q),
  CH: geocodeCh,
  LU: geocodeLu,
  BE: geocodeBe,
};

/**
 * Renvoie null si rien d'utile (pas d'adresse, requête échoue, aucun résultat,
 * ou correspondance trop douteuse pour être fiable).
 */
export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const parts = [input.address, input.postal_code, input.city].map(clean).filter((s): s is string => s !== null);
  const q = parts.join(' ');
  if (q.length < 3) return null;

  const zip = bareZip(input.postal_code);
  const foreignQ = [clean(input.address), zip, clean(input.city)].filter(Boolean).join(' ');

  for (const country of candidateCountries(input.postal_code)) {
    try {
      const result = await GEOCODERS[country](country === 'FR' ? q : foreignQ, zip, clean(input.city));
      if (result) return result;
    } catch {
      // Service injoignable : on tente le pays suivant.
    }
  }
  return null;
}
