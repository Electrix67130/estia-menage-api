import { describe, expect, it } from 'vitest';
import {
  CODE_LABEL_SUGGESTIONS,
  createLogementCodeSchema,
} from '@/modules/logement-code/logement-code.schema';
import {
  EQUIPEMENT_CATALOG,
  createLogementEquipementSchema,
} from '@/modules/logement-equipement/logement-equipement.schema';

describe('createLogementCodeSchema', () => {
  const base = { logement_id: '11111111-1111-4111-8111-111111111111', label: 'Portail', code: 'A12B' };

  it('accepte un libellé libre', () => {
    expect(createLogementCodeSchema.parse(base).label).toBe('Portail');
  });

  it('refuse un code vide', () => {
    expect(createLogementCodeSchema.safeParse({ ...base, code: '' }).success).toBe(false);
  });

  it('refuse un logement_id qui n’est pas un uuid', () => {
    expect(createLogementCodeSchema.safeParse({ ...base, logement_id: 'x' }).success).toBe(false);
  });

  it('propose des libellés courants sans les imposer', () => {
    expect(CODE_LABEL_SUGGESTIONS).toContain('Boîte à clés');
    // Le catalogue est une aide à la saisie : un libellé hors liste passe.
    expect(createLogementCodeSchema.safeParse({ ...base, label: 'Cadenas du local vélo' }).success).toBe(true);
  });
});

describe('createLogementEquipementSchema', () => {
  const base = { logement_id: '11111111-1111-4111-8111-111111111111', label: 'Appareil à raclette' };

  it('accepte un équipement minimal, quantité par défaut côté service', () => {
    expect(createLogementEquipementSchema.parse(base).label).toBe('Appareil à raclette');
  });

  it('refuse une quantité nulle', () => {
    expect(createLogementEquipementSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
  });

  it('refuse une famille inconnue', () => {
    expect(createLogementEquipementSchema.safeParse({ ...base, category: 'jardinage' }).success).toBe(false);
  });

  it('propose la raclette et la fondue dans le catalogue cuisine', () => {
    expect(EQUIPEMENT_CATALOG.cuisine).toContain('Appareil à raclette');
    expect(EQUIPEMENT_CATALOG.cuisine).toContain('Appareil à fondue');
    expect(EQUIPEMENT_CATALOG.bebe).toContain('Chaise haute');
  });
});
