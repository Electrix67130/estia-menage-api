import { SectionType } from './menage-check.schema';

/**
 * Templates par défaut d'items de checklist, par type de pièce.
 * Utilisés à la création automatique de la checklist d'un ménage.
 * Évolution prévue : déplacer ces templates en table SQL éditable par admin org.
 */
export const DEFAULT_CHECK_ITEMS_BY_TYPE: Record<SectionType, string[]> = {
  kitchen: [
    'Vider et nettoyer le frigo',
    'Dégraisser plaque et four',
    'Nettoyer micro-ondes',
    'Nettoyer évier et robinetterie',
    'Sortir les poubelles',
    'Aspirer et laver le sol',
  ],
  bathroom: [
    'Nettoyer douche / baignoire',
    'Détartrer robinetterie',
    'Nettoyer miroir',
    'Désinfecter lavabo',
    'Nettoyer le sol',
    'Renouveler serviettes',
  ],
  wc: [
    'Désinfecter cuvette',
    'Détartrer',
    'Nettoyer le sol',
    'Vider poubelle',
  ],
  bedroom: [
    'Changer les draps',
    'Aspirer le sol',
    'Dépoussiérer surfaces',
    'Nettoyer miroir',
    'Vider poubelle',
  ],
  living_room: [
    'Aspirer et laver le sol',
    'Dépoussiérer surfaces',
    'Aérer la pièce',
    'Réagencer coussins',
  ],
  exterior: [
    'Nettoyer mobilier extérieur',
    'Balayer terrasse / balcon',
    'Vider cendrier si présent',
  ],
  basement: ['Vérifier propreté', 'Aspirer si nécessaire'],
  laundry: ['Vider sèche-linge', 'Lancer linge sale en machine'],
  pool: [
    'Nettoyer la ligne d\'eau',
    'Passer le robot / l\'épuisette',
    'Nettoyer skimmers et filtre',
    'Vérifier le niveau et le traitement de l\'eau',
    'Ranger le mobilier et nettoyer les abords',
  ],
  jacuzzi: [
    'Vider et rincer la cuve si nécessaire',
    'Nettoyer la cuve et la ligne d\'eau',
    'Nettoyer les filtres',
    'Vérifier le niveau et le traitement de l\'eau',
    'Replacer la couverture',
  ],
  general: [
    'Vérifier état général du logement',
    'Remettre les clés à leur place',
    'Vérifier portes et fenêtres fermées',
  ],
};

interface SectionPlan {
  type: SectionType;
  label: string;
}

interface LogementParams {
  n_bedrooms: number;
  n_bathrooms: number;
  n_wc: number;
  n_kitchens: number;
  n_living_rooms: number;
  n_exterior_spaces: number;
  has_basement: boolean;
  has_laundry: boolean;
  has_pool: boolean;
  has_jacuzzi: boolean;
}

const SINGLE_SECTION_LABELS: Record<SectionType, string> = {
  kitchen: 'Cuisine',
  living_room: 'Salon',
  bedroom: 'Chambre',
  bathroom: 'Salle de bain',
  wc: 'WC',
  exterior: 'Espace extérieur',
  basement: 'Cave',
  laundry: 'Buanderie',
  pool: 'Piscine',
  jacuzzi: 'Jacuzzi',
  general: 'Tâches générales',
};

/**
 * Construit la liste ordonnée des sections (pièces) à créer pour un ménage,
 * à partir des paramètres de son logement.
 */
export function buildSectionPlan(logement: LogementParams): SectionPlan[] {
  const sections: SectionPlan[] = [];

  const addRepeated = (type: SectionType, count: number) => {
    if (count <= 1 && count > 0) {
      sections.push({ type, label: SINGLE_SECTION_LABELS[type] });
      return;
    }
    for (let i = 1; i <= count; i++) {
      sections.push({ type, label: `${SINGLE_SECTION_LABELS[type]} ${i}` });
    }
  };

  addRepeated('kitchen', logement.n_kitchens);
  addRepeated('living_room', logement.n_living_rooms);
  addRepeated('bedroom', logement.n_bedrooms);
  addRepeated('bathroom', logement.n_bathrooms);
  addRepeated('wc', logement.n_wc);
  addRepeated('exterior', logement.n_exterior_spaces);
  if (logement.has_basement) sections.push({ type: 'basement', label: SINGLE_SECTION_LABELS.basement });
  if (logement.has_laundry) sections.push({ type: 'laundry', label: SINGLE_SECTION_LABELS.laundry });
  if (logement.has_pool) sections.push({ type: 'pool', label: SINGLE_SECTION_LABELS.pool });
  if (logement.has_jacuzzi) sections.push({ type: 'jacuzzi', label: SINGLE_SECTION_LABELS.jacuzzi });
  sections.push({ type: 'general', label: SINGLE_SECTION_LABELS.general });

  return sections;
}
