import fp from 'fastify-plugin';
import { z } from 'zod';

const querySchema = z.object({ siret: z.string().regex(/^\d{14}$/, 'SIRET = 14 chiffres') });

interface UpstreamEtab {
  siret?: string;
  adresse?: string;
  geo_adresse?: string;
}
interface UpstreamResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  siege?: UpstreamEtab;
  matching_etablissements?: UpstreamEtab[];
}
interface UpstreamResponse {
  results?: UpstreamResult[];
}

/** TVA intracommunautaire FR calculée depuis le SIREN. */
function frVatNumber(siren: string): string {
  const n = Number(siren);
  if (!Number.isFinite(n)) return '';
  const key = (12 + 3 * (n % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

/**
 * GET /company/lookup?siret= — résout un SIRET via l'annuaire public
 * (recherche-entreprises.api.gouv.fr) et renvoie raison sociale, adresse,
 * SIREN et n° TVA. Sert à pré-remplir les infos d'entreprise d'un prestataire.
 */
export default fp(
  (fastify, _opts, done) => {
    fastify.get(
      '/company/lookup',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { siret } = querySchema.parse(request.query);

        let json: UpstreamResponse;
        try {
          const res = await fetch(
            `https://recherche-entreprises.api.gouv.fr/search?q=${siret}&page=1&per_page=1`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (!res.ok) throw new Error(`upstream ${res.status}`);
          json = (await res.json()) as UpstreamResponse;
        } catch {
          return reply.code(502).send({
            statusCode: 502,
            error: 'Bad Gateway',
            message: "L'annuaire des entreprises est momentanément indisponible",
          });
        }

        const result = json.results?.[0];
        if (!result) {
          return reply.code(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Aucune entreprise trouvée pour ce SIRET',
          });
        }

        const siege = result.siege ?? {};
        const matching = result.matching_etablissements?.[0];
        const etab = siege.siret === siret ? siege : (matching ?? siege);
        const siren = result.siren ?? siret.slice(0, 9);

        return {
          siret,
          siren,
          name: result.nom_complet ?? result.nom_raison_sociale ?? '',
          address: etab.adresse ?? etab.geo_adresse ?? '',
          vat_number: frVatNumber(siren),
        };
      },
    );
    done();
  },
  { name: 'company-lookup-module' },
);
