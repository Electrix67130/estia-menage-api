import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import {
  addLogementMember,
  createLogement,
  createMenage,
  createOrgWithAdmin,
  createUser,
  type TestUser,
} from '../helpers/factories';
import { capturerPush, enregistrerAppareil, laisserPartirLesPush, type PushCapturee } from '../helpers/push';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());

let push: { messages: PushCapturee[]; restore: () => void };
beforeEach(async () => {
  await truncateAll(app.db);
  push = capturerPush();
});
afterEach(() => push.restore());

interface Contexte {
  organizationId: string;
  admin: TestUser;
  /** Prestataire de l'org, membre du logement. */
  presta: TestUser;
  logementId: string;
}

async function contexte(): Promise<Contexte> {
  const { organizationId, admin } = await createOrgWithAdmin(app, 'Conciergerie');
  const presta = await createUser(app, { organizationId, role: 'prestataire' });
  const logementId = await createLogement(app, { organizationId, createdBy: admin.id, name: 'Villa Rose' });
  await addLogementMember(app, { logementId, userId: presta.id });
  return { organizationId, admin, presta, logementId };
}

describe('inventaire des équipements', () => {
  it('le catalogue sert les mêmes suggestions aux deux apps', async () => {
    const { presta } = await contexte();
    const res = await app.inject({ method: 'GET', url: '/logement-equipements/catalog', headers: auth(presta.token) });
    expect(res.statusCode).toBe(200);
    const cuisine = (res.json().categories as { key: string; label: string; suggestions: string[] }[]).find(
      (c) => c.key === 'cuisine',
    );
    expect(cuisine?.label).toBe('Cuisine');
    expect(cuisine?.suggestions).toContain('Appareil à raclette');
  });

  it('écriture admin, lecture par tout prestataire de l’organisation — jamais hors de l’org', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const horsLogement = await createUser(app, { organizationId, role: 'prestataire' });
    const autre = await createOrgWithAdmin(app, 'Voisine');

    const refus = await app.inject({
      method: 'POST',
      url: '/logement-equipements',
      headers: auth(horsLogement.token),
      payload: { logement_id: logementId, label: 'Lave-vaisselle' },
    });
    expect(refus.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/logement-equipements',
      headers: auth(admin.token),
      payload: { logement_id: logementId, label: 'Lave-vaisselle', category: 'electromenager' },
    });
    expect(ok.statusCode).toBe(201);

    const lecture = await app.inject({ method: 'GET', url: `/logement-equipements?logement_id=${logementId}`, headers: auth(horsLogement.token) });
    expect(lecture.statusCode).toBe(200);
    expect(lecture.json()).toHaveLength(1);
    const voisine = await app.inject({ method: 'GET', url: `/logement-equipements?logement_id=${logementId}`, headers: auth(autre.admin.token) });
    expect(voisine.statusCode).toBe(404);
  });

  it('l’ajout groupé est idempotent : pas de doublon, même en changeant la casse', async () => {
    const { admin, logementId } = await contexte();
    const bulk = (items: { label: string; category?: string }[]) =>
      app.inject({
        method: 'POST',
        url: '/logement-equipements/bulk',
        headers: auth(admin.token),
        payload: { logement_id: logementId, items },
      });
    const premier = await bulk([{ label: 'Four', category: 'cuisine' }, { label: 'four ' }, { label: 'Barbecue', category: 'exterieur' }]);
    expect(premier.statusCode).toBe(201);
    expect(premier.json().map((e: { label: string }) => e.label).sort()).toEqual(['Barbecue', 'Four']);

    const second = await bulk([{ label: 'FOUR' }, { label: 'Plancha' }]);
    expect(second.json().map((e: { label: string }) => e.label).sort()).toEqual(['Barbecue', 'Four', 'Plancha']);
    expect(await app.db('logement_equipement').where({ logement_id: logementId })).toHaveLength(3);
  });

  it('la modification ne traverse pas les organisations', async () => {
    const { admin, logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const [eq] = await app.db('logement_equipement').insert({ logement_id: logementId, label: 'Four' }).returning('id');
    const res = await app.inject({
      method: 'PATCH',
      url: `/logement-equipements/${eq.id}`,
      headers: auth(autre.admin.token),
      payload: { label: 'Piraté' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('équipements à préparer sur une prestation', () => {
  it('l’admin définit la liste depuis l’inventaire ; le prestataire la consulte sans la cocher', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, prestataireUserId: presta.id });
    const [chaise] = await app.db('logement_equipement').insert({ logement_id: logementId, label: 'Chaise haute' }).returning('id');
    const autreLogement = await createLogement(app, { organizationId, createdBy: admin.id });
    const [ailleurs] = await app.db('logement_equipement').insert({ logement_id: autreLogement, label: 'Lit bébé' }).returning('id');

    const parPresta = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/equipements`,
      headers: auth(presta.token),
      payload: { items: [{ logement_equipement_id: chaise.id }] },
    });
    expect(parPresta.statusCode).toBe(403);

    const horsLogement = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/equipements`,
      headers: auth(admin.token),
      payload: { items: [{ logement_equipement_id: ailleurs.id }] },
    });
    expect(horsLogement.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/equipements`,
      headers: auth(admin.token),
      payload: { items: [{ logement_equipement_id: chaise.id, quantity: 2 }] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()[0]).toMatchObject({ label: 'Chaise haute', quantity: 2, done_at: null });

    const lecture = await app.inject({ method: 'GET', url: `/menages/${menageId}/equipements`, headers: auth(presta.token) });
    expect(lecture.statusCode).toBe(200);
    const coche = await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}/equipements/${chaise.id}`,
      headers: auth(presta.token),
      payload: { done: true },
    });
    expect(coche.statusCode).toBe(403);
  });

  it('ré-enregistrer la liste ne décoche pas ce qui est déjà préparé', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id });
    const [chaise] = await app.db('logement_equipement').insert({ logement_id: logementId, label: 'Chaise haute' }).returning('id');
    const [baignoire] = await app.db('logement_equipement').insert({ logement_id: logementId, label: 'Baignoire bébé' }).returning('id');
    const definir = (items: { logement_equipement_id: string; notes?: string }[]) =>
      app.inject({ method: 'PUT', url: `/menages/${menageId}/equipements`, headers: auth(admin.token), payload: { items } });

    await definir([{ logement_equipement_id: chaise.id }]);
    const coche = await app.inject({
      method: 'PATCH',
      url: `/menages/${menageId}/equipements/${chaise.id}`,
      headers: auth(admin.token),
      payload: { done: true },
    });
    expect(coche.json().done_at).not.toBeNull();
    expect(coche.json().done_by).toBe(admin.id);

    const res = await definir([{ logement_equipement_id: chaise.id, notes: 'côté fenêtre' }, { logement_equipement_id: baignoire.id }]);
    const lignes = res.json() as { label: string; done_at: string | null; notes: string | null }[];
    expect(lignes.find((l) => l.label === 'Chaise haute')).toMatchObject({ notes: 'côté fenêtre' });
    expect(lignes.find((l) => l.label === 'Chaise haute')?.done_at).not.toBeNull();
    expect(lignes.find((l) => l.label === 'Baignoire bébé')?.done_at).toBeNull();
  });
});

describe('options / packs', () => {
  it('propose des suggestions et ne laisse qu’un admin configurer les packs', async () => {
    const { admin, presta, logementId } = await contexte();
    const suggestions = await app.inject({ method: 'GET', url: '/logement-options/suggestions', headers: auth(presta.token) });
    expect(suggestions.json().labels).toContain('Pack romantique');

    const refus = await app.inject({
      method: 'POST',
      url: '/logement-options',
      headers: auth(presta.token),
      payload: { logement_id: logementId, label: 'Pack romantique' },
    });
    expect(refus.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/logement-options',
      headers: auth(admin.token),
      payload: { logement_id: logementId, label: '  Pack romantique ', description: 'Pétales + bougies' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().label).toBe('Pack romantique');
  });

  it('l’admin coche l’option retenue par le client, dans le logement de la prestation seulement', async () => {
    const { organizationId, admin, presta, logementId } = await contexte();
    const menageId = await createMenage(app, { logementId, organizationId, createdBy: admin.id, prestataireUserId: presta.id });
    const [romantique] = await app.db('logement_option').insert({ logement_id: logementId, label: 'Pack romantique' }).returning('id');
    const [anniversaire] = await app.db('logement_option').insert({ logement_id: logementId, label: 'Pack anniversaire' }).returning('id');
    const autreLogement = await createLogement(app, { organizationId, createdBy: admin.id });
    const [ailleurs] = await app.db('logement_option').insert({ logement_id: autreLogement, label: 'Panier' }).returning('id');
    const definir = (token: string, items: { logement_option_id: string; notes?: string }[]) =>
      app.inject({ method: 'PUT', url: `/menages/${menageId}/options`, headers: auth(token), payload: { items } });

    expect((await definir(presta.token, [{ logement_option_id: romantique.id }])).statusCode).toBe(403);
    expect((await definir(admin.token, [{ logement_option_id: ailleurs.id }])).statusCode).toBe(400);

    await definir(admin.token, [{ logement_option_id: romantique.id, notes: 'Bouteille au frais' }]);
    const remplace = await definir(admin.token, [{ logement_option_id: anniversaire.id }]);
    expect(remplace.json().map((o: { label: string }) => o.label)).toEqual(['Pack anniversaire']);

    const lecture = await app.inject({ method: 'GET', url: `/menages/${menageId}/options`, headers: auth(presta.token) });
    expect(lecture.statusCode).toBe(200);
    expect(lecture.json()).toHaveLength(1);
  });
});

describe('pièces du logement', () => {
  it('nomme automatiquement les pièces typées, exige un nom pour « autre »', async () => {
    const { admin, presta, logementId } = await contexte();
    const creer = (token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/logement-rooms', headers: auth(token), payload: { logement_id: logementId, ...payload } });

    expect((await creer(presta.token, { kind: 'chambre' })).statusCode).toBe(403);
    expect((await creer(admin.token, { kind: 'autre' })).statusCode).toBe(400);

    expect((await creer(admin.token, { kind: 'chambre' })).json().name).toBe('Chambre 1');
    expect((await creer(admin.token, { kind: 'chambre' })).json().name).toBe('Chambre 2');
    expect((await creer(admin.token, { kind: 'autre', name: 'Cabane' })).json().name).toBe('Cabane');

    const lecture = await app.inject({ method: 'GET', url: `/logement-rooms?logement_id=${logementId}`, headers: auth(presta.token) });
    expect(lecture.json()).toHaveLength(3);
  });

  it('changer le type re-dérive le nom', async () => {
    const { admin, logementId } = await contexte();
    const [room] = await app.db('logement_room').insert({ logement_id: logementId, name: 'Pièce', kind: 'autre' }).returning('id');
    const res = await app.inject({
      method: 'PATCH',
      url: `/logement-rooms/${room.id}`,
      headers: auth(admin.token),
      payload: { kind: 'salle_de_bain' },
    });
    expect(res.json().name).toBe('Salle de bain 1');
  });
});

describe('consommables', () => {
  async function avecConsommable(ctx: Contexte, seuil = 2) {
    const res = await app.inject({
      method: 'POST',
      url: '/logement-consommables',
      headers: auth(ctx.admin.token),
      payload: { logement_id: ctx.logementId, label: 'Papier toilette', unit: 'rouleaux', seuil_alerte: seuil },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('la configuration est admin ; le stock courant est le dernier relevé', async () => {
    const ctx = await contexte();
    const refus = await app.inject({
      method: 'POST',
      url: '/logement-consommables',
      headers: auth(ctx.presta.token),
      payload: { logement_id: ctx.logementId, label: 'Savon' },
    });
    expect(refus.statusCode).toBe(403);
    const consoId = await avecConsommable(ctx);

    const stock = await app.inject({
      method: 'PUT',
      url: `/logement-consommables/${consoId}/stock`,
      headers: auth(ctx.admin.token),
      payload: { qty: 1 },
    });
    expect(stock.statusCode).toBe(200);
    expect(stock.json().data).toMatchObject({ current_qty: 1, needs_restock: true });

    const liste = await app.inject({ method: 'GET', url: `/logement-consommables?logement_id=${ctx.logementId}`, headers: auth(ctx.presta.token) });
    expect(liste.json()[0]).toMatchObject({ label: 'Papier toilette', qty: 1, needs_restock: true });
  });

  it('le relevé de fin de ménage est réservé au prestataire assigné (ou à l’admin) et alerte sous le seuil', async () => {
    const ctx = await contexte();
    const consoId = await avecConsommable(ctx, 2);
    const jetonAdmin = await enregistrerAppareil(app, ctx.admin.id);
    const autre = await createUser(app, { organizationId: ctx.organizationId, role: 'prestataire' });
    await addLogementMember(app, { logementId: ctx.logementId, userId: autre.id });
    const menageId = await createMenage(app, {
      logementId: ctx.logementId,
      organizationId: ctx.organizationId,
      createdBy: ctx.admin.id,
      prestataireUserId: ctx.presta.id,
    });
    const relever = (token: string, qty: number) =>
      app.inject({
        method: 'PUT',
        url: `/menages/${menageId}/consommables`,
        headers: auth(token),
        payload: { items: [{ logement_consommable_id: consoId, qty }] },
      });

    expect((await relever(autre.token, 1)).statusCode).toBe(403);
    const ok = await relever(ctx.presta.token, 1);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data[0]).toMatchObject({ qty: 1, current_qty: 1, needs_restock: true });

    await laisserPartirLesPush();
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({ to: jetonAdmin, title: 'Consommables à racheter' });
    expect(push.messages[0].body).toContain('Papier toilette');

    // Corriger le relevé met à jour la même ligne (un relevé par ménage et par consommable).
    await relever(ctx.presta.token, 6);
    expect(await app.db('menage_consommable_releve').where({ menage_id: menageId })).toHaveLength(1);
    const detail = await app.inject({ method: 'GET', url: `/menages/${menageId}/consommables`, headers: auth(ctx.presta.token) });
    expect(detail.json()[0]).toMatchObject({ qty: 6, needs_restock: false });
  });

  it('un relevé ignore un consommable d’un autre logement, et la suppression archive sans perdre l’historique', async () => {
    const ctx = await contexte();
    const consoId = await avecConsommable(ctx);
    const autreLogement = await createLogement(app, { organizationId: ctx.organizationId, createdBy: ctx.admin.id });
    const [intrus] = await app.db('logement_consommable').insert({ logement_id: autreLogement, label: 'Savon' }).returning('id');
    const menageId = await createMenage(app, { logementId: ctx.logementId, organizationId: ctx.organizationId, createdBy: ctx.admin.id });

    const res = await app.inject({
      method: 'PUT',
      url: `/menages/${menageId}/consommables`,
      headers: auth(ctx.admin.token),
      payload: { items: [{ logement_consommable_id: intrus.id, qty: 0 }, { logement_consommable_id: consoId, qty: 3 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(await app.db('menage_consommable_releve').where({ menage_id: menageId })).toHaveLength(1);

    expect((await app.inject({ method: 'DELETE', url: `/logement-consommables/${consoId}`, headers: auth(ctx.admin.token) })).statusCode).toBe(204);
    const liste = await app.inject({ method: 'GET', url: `/logement-consommables?logement_id=${ctx.logementId}`, headers: auth(ctx.admin.token) });
    expect(liste.json()).toHaveLength(0);
    expect(await app.db('menage_consommable_releve').where({ logement_consommable_id: consoId })).toHaveLength(1);
  });
});

describe('modèles de checklist', () => {
  it('le modèle propre au logement se construit par sections et items, par l’admin', async () => {
    const { admin, presta, logementId } = await contexte();
    const refus = await app.inject({
      method: 'POST',
      url: '/logement-check-template-sections',
      headers: auth(presta.token),
      payload: { logement_id: logementId, label: 'Cuisine' },
    });
    expect(refus.statusCode).toBe(403);

    const section = (
      await app.inject({
        method: 'POST',
        url: '/logement-check-template-sections',
        headers: auth(admin.token),
        payload: { logement_id: logementId, label: 'Cuisine', icon: '🍳' },
      })
    ).json();
    const item = await app.inject({
      method: 'POST',
      url: '/logement-check-template-items',
      headers: auth(admin.token),
      payload: { section_id: section.id, label: 'Dégraisser la hotte' },
    });
    expect(item.statusCode).toBe(201);

    const arbre = await app.inject({ method: 'GET', url: `/logement-check-templates?logement_id=${logementId}`, headers: auth(presta.token) });
    expect(arbre.json()).toHaveLength(1);
    expect(arbre.json()[0]).toMatchObject({ label: 'Cuisine', icon: '🍳' });
    expect(arbre.json()[0].items.map((i: { label: string }) => i.label)).toEqual(['Dégraisser la hotte']);
  });

  it('un item ne peut pas être greffé sur la section d’une autre organisation', async () => {
    const { logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    const [section] = await app
      .db('logement_check_template_section')
      .insert({ logement_id: logementId, label: 'Cuisine' })
      .returning('id');
    const res = await app.inject({
      method: 'POST',
      url: '/logement-check-template-items',
      headers: auth(autre.admin.token),
      payload: { section_id: section.id, label: 'Intrus' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('un modèle d’organisation s’applique à un logement en s’ajoutant à la suite, puis nourrit la checklist', async () => {
    const { organizationId, admin, logementId } = await contexte();
    const autre = await createOrgWithAdmin(app, 'Voisine');
    await app.db('logement_check_template_section').insert({ logement_id: logementId, label: 'Existant', position: 0 });

    const modele = await app.inject({
      method: 'POST',
      url: '/checklist-templates',
      headers: auth(admin.token),
      payload: {
        name: 'Standard studio',
        sections: [{ label: 'Salle de bain', items: [{ label: 'Détartrer' }, { label: 'Serviettes', required: false }] }],
      },
    });
    expect(modele.statusCode).toBe(201);
    expect(modele.json().sections[0].items).toHaveLength(2);

    // Ni le modèle ni le logement n'existent pour une autre organisation.
    expect(
      (await app.inject({ method: 'GET', url: `/checklist-templates/${modele.json().id}`, headers: auth(autre.admin.token) })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/logements/${logementId}/apply-checklist-template`,
          headers: auth(autre.admin.token),
          payload: { template_id: modele.json().id },
        })
      ).statusCode,
    ).toBe(404);

    const application = await app.inject({
      method: 'POST',
      url: `/logements/${logementId}/apply-checklist-template`,
      headers: auth(admin.token),
      payload: { template_id: modele.json().id },
    });
    expect(application.statusCode).toBe(204);
    const arbre = (
      await app.inject({ method: 'GET', url: `/logement-check-templates?logement_id=${logementId}`, headers: auth(admin.token) })
    ).json() as { label: string; position: number }[];
    expect(arbre.map((s) => s.label)).toEqual(['Existant', 'Salle de bain']);

    // La prochaine prestation créée reprend bien ce modèle.
    const menage = await app.inject({
      method: 'POST',
      url: '/menages',
      headers: auth(admin.token),
      payload: { logement_id: logementId, date_prevue: '2026-07-01' },
    });
    const sections = await app.db('menage_check_section').where({ menage_id: menage.json().id }).orderBy('position');
    expect(sections.map((s) => s.section_label)).toEqual(['Existant', 'Salle de bain']);
    void organizationId;
  });
});
