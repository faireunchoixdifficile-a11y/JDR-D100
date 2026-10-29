/* Règles du JDR D100 : fonctions pures (sans dépendance à Foundry), identiques au moteur Python (jdr.py / jdr_combat.py). */
export const SYSTEM_ID = "jdr-d100";
export const STATS = ["COR", "ESP", "PRE"];
export const STAT_NOMS = { COR: "Corps", ESP: "Esprit", PRE: "Présence" };
export const DIFFICULTES = { facile: 20, normale: 0, difficile: -20, tres_difficile: -40 };
export const SEUIL_MAX = 95, CRIT_REUSSITE = 5, CRIT_ECHEC = 96;
export const MALUS_META = 10, MALUS_COUVERT = 20, BONUS_SORT = 20, MALUS_SORT = 20, ARMURE_SORT = 2, BONUS_BOUCLIER = 1;
export const BONUS_AIDE = 20, MALUS_RAGE = 10;
export const DEGATS_MORSURE = "1d4", DEGATS_SOUFFLE = "2d6", DEGATS_SOIN = "1d6";
export const COUT_DES_SORT = { "1d6": 2, "2d6": 3, "3d6": 5, "4d6": 7 };
export const COUT_FIXE_SORT = { bonus: 2, malus: 2, armure: 3 };
export const COUT_AMPLEUR = { mineur: 1, moyen: 3, majeur: 5 };
export const SURCOUT_ZONE = 2;
export const COUT_DEGATS_ARME = { "1d4": 1, "1d6": 2, "1d8": 3, "1d10": 4, "2d6": 5 };
export const BUDGET_EQUIP = 6, BUDGET_RACE = 6, BUDGET_RACE_MJ = 8, MAX_SORTS = 5, MAX_SORTS_DEPART = 3, SURCOUT_SORT = 1, COUT_SORT_MAX = 10;
export const POINTS_CARAC = 30;
/** Sans arme (ou sans armure) précisée, le programme applique l'arme et l'armure par défaut du MJ. */
export const ARME_DEFAUT = "1d8", ARMURE_DEFAUT = 1;

/** Bonus réellement accordé selon la taille du domaine (précis / large / méta) et l'état de validation. */
export function bonusEffectif(bonus, taille, statut) {
  if (statut === "refusee" || taille === "meta") return 0;
  if (taille === "large") return Math.floor(bonus / 2);
  return bonus;
}

/** Résout un test D100 (jet <= seuil) : 01-05 réussite critique, 96-00 échec critique. */
export function evaluerTest(seuil, modif, jet) {
  const effectif = Math.max(1, Math.min(SEUIL_MAX, seuil + modif));
  let resultat;
  if (jet <= CRIT_REUSSITE) resultat = "RÉUSSITE CRITIQUE";
  else if (jet >= CRIT_ECHEC) resultat = "ÉCHEC CRITIQUE";
  else if (jet <= effectif) resultat = "Réussite";
  else resultat = "Échec";
  return { jet, seuil, modif, effectif, resultat, reussite: resultat === "Réussite" || resultat === "RÉUSSITE CRITIQUE",
           critique: resultat === "RÉUSSITE CRITIQUE", maladresse: resultat === "ÉCHEC CRITIQUE", marge: effectif - jet };
}

export const bonusDegats = (cor) => Math.max(0, Math.floor((cor - 10) / 2));
export const defense = (cor) => Math.max(0, (cor - 10) * 2);
export const pvMax = (cor, de, racePv = 0) => cor * 2 + de + racePv;
export const pmMax = (esp, pre, de, racePm = 0) => esp + pre + de + racePm;

/** Malus à TOUS les seuils si le personnage porte une compétence méta non refusée. */
export function malusSeuil(competences) {
  return competences.some((c) => c.taille === "meta" && c.statut !== "refusee") ? MALUS_META : 0;
}

/**
 * Seuil d'un test de compétence (même logique que jdr.seuil_competence).
 * ctx = { caracs:{COR,ESP,PRE}, competences:[{nom,carac,rang,taille,statut,equivalent}], raceComp:[{nom,carac,bonus}] }
 * mode : "plein" (domaine couvert) ou "voisin" (moitié du bonus, pas de bonus de race).
 */
export function seuilCompetence(ctx, comp, mode = "plein", caracDefaut = "ESP") {
  const { caracs, competences, raceComp = [] } = ctx;
  const parNom = new Map(competences.map((c) => [c.nom, c]));
  const noms = [comp, ...competences.filter((c) => c.equivalent === comp).map((c) => c.nom)].filter((n) => parNom.has(n));
  const caracDe = (nom, defaut) => {
    const c = parNom.get(nom);
    if (c && STATS.includes(c.carac)) return c.carac;
    const r = raceComp.find((x) => x.nom === nom);
    return r ? r.carac : defaut;
  };
  let meilleur = caracs[caracDe(comp, caracDefaut)] * 5;
  for (const n of noms) {
    const c = parNom.get(n);
    const b = bonusEffectif(c.rang, c.taille, c.statut);
    meilleur = Math.max(meilleur, caracs[caracDe(n, "ESP")] * 5 + (mode === "plein" ? b : Math.floor(b / 2)));
  }
  const race = raceComp.filter((c) => c.nom === comp).reduce((s, c) => s + c.bonus, 0);
  return meilleur + (mode === "plein" ? race : 0) - malusSeuil(competences);
}

/** Seuil d'un test de caractéristique seule. */
export const seuilCarac = (caracs, stat, competences = []) => Math.max(1, caracs[stat] * 5 - malusSeuil(competences));

/** Coût en PM d'un sort. */
export function coutSort(s) {
  let base;
  if (s.type === "degats" || s.type === "soin") base = COUT_DES_SORT[s.valeur] ?? 99;
  else if (s.type in COUT_FIXE_SORT) base = COUT_FIXE_SORT[s.type];
  else if (s.type === "narratif") base = COUT_AMPLEUR[s.ampleur] ?? 99;
  else return 99;
  if (base >= 99) return 99;
  return base + (s.type === "narratif" ? 0 : (s.zone ? SURCOUT_ZONE : 0)) + SURCOUT_SORT;
}

/** Points d'équipement dépensés : arme (dés + tir), armure, bouclier, objets à bonus (1 pt chacun). */
export function coutEquipement({ arme = null, armure = 0, bouclier = false, objetsBonus = 0 }) {
  return (arme ? (COUT_DEGATS_ARME[arme.degats] ?? 99) + (arme.distance ? 1 : 0) : 0) + armure + (bouclier ? 1 : 0) + objetsBonus;
}

/** Dégâts d'une attaque réussie : (jets + dés si critique) - armure, minimum 1 si critique ; élément résisté : moitié. */
export function degatsAttaque({ total, sommeDes, critique, armure, resiste = false }) {
  const brut = total + (critique ? sommeDes : 0);
  const dmg = Math.max(critique ? 1 : 0, brut - armure);
  return resiste ? Math.floor(dmg / 2) : dmg;
}

/** Dégâts d'un sort : armure ignorée ; zone : moitié. */
export function degatsSort({ total, sommeDes, critique, zone, resiste = false }) {
  const brut = total + (critique ? sommeDes : 0);
  const dmg = Math.max(critique ? 1 : 0, zone ? Math.floor(brut / 2) : brut);
  return resiste ? Math.floor(dmg / 2) : dmg;
}

/** Soin d'un sort : zone moitié, minimum 1. */
export function soinSort({ total, sommeDes, critique, zone }) {
  const gain = total + (critique ? sommeDes : 0);
  return Math.max(1, zone ? Math.floor(gain / 2) : gain);
}

/** Modificateur d'un test offensif contre une cible. */
export function modifOffensif({ defenseCible, extra = 0, tireur = false, cibleCouverte = false, malusLumiere = 0, lumiereVive = false }) {
  let m = -defenseCible + extra;
  if (lumiereVive) m -= malusLumiere;
  if (tireur && cibleCouverte) m -= MALUS_COUVERT;
  return m;
}

/** Remplace "2d6+1" par ses dés doublés n'est PAS la règle : le critique ajoute la somme des dés une seconde fois. */
export const estExpressionDes = (e) => /^\s*\d*\s*d\s*\d+\s*([+-]\s*\d+)?\s*$/i.test(e || "");
