/* Modèles de données (Foundry v14 : TypeDataModel, types déclarés dans system.json). */
import * as R from "./rules.mjs";

const f = foundry.data.fields;
const { TypeDataModel } = foundry.abstract;

const entier = (initial = 0, extra = {}) => new f.NumberField({ required: true, integer: true, initial, nullable: false, ...extra });
const texte = (initial = "") => new f.StringField({ required: true, blank: true, initial });
const choix = (choices, initial) => new f.StringField({ required: true, choices, initial, blank: false });
const stat = () => new f.SchemaField({ base: entier(10, { min: 1, max: 30 }) });
const jauge = (v) => new f.SchemaField({ value: entier(v, { min: -99 }), max: entier(v, { min: 0 }) });

const etatSchema = () => new f.SchemaField({
  statut: choix(["debout", "inconscient", "stabilise", "mort", "fuite"], "debout"),
  tours: entier(0, { min: 0 }),          // tours avant la mort d'un inconscient
  aide: entier(0), malus: entier(0),     // +20 reçu d'un allié / -20 subi d'un sort, consommés par la prochaine attaque
  couvert: new f.BooleanField({ initial: false }), protege: new f.BooleanField({ initial: false }),
  rageUtilisee: new f.BooleanField({ initial: false }), rageAttaques: entier(0, { min: 0 }),
  souffleUtilise: new f.BooleanField({ initial: false }), soigne: new f.BooleanField({ initial: false }),
});

/** Éléments communs aux PJ et aux adversaires. */
class Combattant extends TypeDataModel {
  static defineSchema() {
    return {
      caracs: new f.SchemaField({ COR: stat(), ESP: stat(), PRE: stat() }),
      pv: jauge(20), pm: jauge(0),
      etat: etatSchema(),
      description: new f.HTMLField({ required: false, initial: "" }),
    };
  }

  /** Objets embarqués par type. */
  get _items() {
    const items = this.parent?.items;
    const par = (t) => (items ? items.filter((i) => i.type === t) : []);
    return { race: par("race")[0] ?? null, competences: par("competence"), armes: par("arme"), armures: par("armure"), sorts: par("sort"), objets: par("objet") };
  }

  prepareBaseData() {
    this.malus = 0; this.raceComp = []; this.competencesCtx = [];
  }

  prepareDerivedData() {
    const it = this._items, race = it.race?.system;
    this.competencesCtx = it.competences.map((c) => ({ nom: c.name, carac: c.system.carac, rang: c.system.rang, taille: c.system.taille, statut: c.system.statut, equivalent: c.system.equivalent }));
    this.malus = R.malusSeuil(this.competencesCtx);
    this.raceComp = race ? race.comp.map((c) => ({ nom: c.nom, carac: c.carac, bonus: c.bonus })) : [];
    for (const s of R.STATS) {
      const mod = race ? (race.mods[s] ?? 0) : 0;
      this.caracs[s].mod = mod;
      this.caracs[s].value = this.caracs[s].base + mod;
      this.caracs[s].seuil = Math.max(1, this.caracs[s].value * 5 - this.malus);
    }
    this.defense = R.defense(this.caracs.COR.value);
    this.bonusDegats = R.bonusDegats(this.caracs.COR.value);
  }
}

export class PJData extends Combattant {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      pvDe: entier(5, { min: 0, max: 10 }), pmDe: entier(5, { min: 0, max: 10 }),
      budgetRace: entier(R.BUDGET_RACE, { min: 0, max: 20 }),
      reglages: new f.SchemaField({ difficulte: choix(Object.keys(R.DIFFICULTES), "normale"), modif: entier(0) }),
      notes: new f.HTMLField({ required: false, initial: "" }),
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const it = this._items, race = it.race?.system;
    const c = this.caracs;
    this.pv.max = R.pvMax(c.COR.value, this.pvDe, race?.pv ?? 0);
    this.pm.max = R.pmMax(c.ESP.value, c.PRE.value, this.pmDe, race?.pm ?? 0);
    const arme = it.armes.find((a) => a.system.equipe) ?? null;
    const armure = it.armures.find((a) => a.system.equipe && !a.system.bouclier) ?? null;
    const bouclier = it.armures.some((a) => a.system.equipe && a.system.bouclier);
    this.arme = arme ? { nom: arme.name, degats: arme.system.degats, distance: arme.system.distance } : { nom: "Arme par défaut", degats: R.ARME_DEFAUT, distance: false, defaut: true };
    const valeurArmure = (armure?.system.valeur ?? 0) + (bouclier ? R.BONUS_BOUCLIER : 0);
    this.armureBase = (valeurArmure || R.ARMURE_DEFAUT) + (race?.armure ?? 0);
    this.armure = this.armureBase + (this.etat.protege ? R.ARMURE_SORT : 0);
    this.attaque = Math.max(1, c.COR.value * 5 - this.malus);
    this.seuilFuite = Math.max(c.COR.value * 5 - this.malus, R.seuilCompetence({ caracs: this.persoCaracs(), competences: this.competencesCtx, raceComp: this.raceComp }, "Acrobaties", "plein", "COR"));
    this.regen = race?.regen ?? 0;
    this.traits = race ? { rage: race.rage, souffle: race.souffle, armeNaturelle: race.armeNaturelle, drain: race.drain, resist: race.resist } : {};
    const objets = it.objets.filter((o) => o.system.bonus);
    this.budget = {
      equip: R.coutEquipement({ arme: arme ? this.arme : null, armure: armure?.system.valeur ?? 0, bouclier, objetsBonus: objets.length }),
      equipMax: R.BUDGET_EQUIP, sorts: it.sorts.length, sortsMax: R.MAX_SORTS,
    };
    this.budget.equipDepasse = this.budget.equip > this.budget.equipMax;
    this.budget.sortsDepasse = this.budget.sorts > this.budget.sortsMax;
    this.points = { total: R.STATS.reduce((s, k) => s + c[k].base, 0), cible: R.POINTS_CARAC };
  }

  persoCaracs() { return { COR: this.caracs.COR.value, ESP: this.caracs.ESP.value, PRE: this.caracs.PRE.value }; }
}

export class AdversaireData extends Combattant {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      rang: choix(["Sbire", "Standard", "Élite", "Boss"], "Standard"),
      cout: entier(2, { min: 0 }),
      attaque: entier(50, { min: 1, max: 95 }), degats: texte("1d6"), armureBase: entier(0, { min: 0 }),
      trait: texte(""), race: texte(""), element: texte(""), resist: texte(""),
      distance: new f.BooleanField({ initial: false }), regen: entier(0, { min: 0 }), malusLumiere: entier(0, { min: 0 }),
      souffle: new f.BooleanField({ initial: false }), drain: new f.BooleanField({ initial: false }),
      rage: new f.BooleanField({ initial: false }), armeNaturelle: new f.BooleanField({ initial: false }),
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.seuilFuite = this.caracs.COR.value * 5;
    this.traits = { rage: this.rage, souffle: this.souffle, armeNaturelle: this.armeNaturelle, drain: this.drain, resist: this.resist };
    this.arme = { nom: "Attaque", degats: this.degats, distance: this.distance };
    this.armure = this.armureBase + (this.etat.protege ? R.ARMURE_SORT : 0);   // pv.max et pm.max sont saisis directement
  }
}

/* ------------------------------------------------------------------ objets */
export class RaceData extends TypeDataModel {
  static defineSchema() {
    return {
      mods: new f.SchemaField({ COR: entier(0, { min: -5, max: 5 }), ESP: entier(0, { min: -5, max: 5 }), PRE: entier(0, { min: -5, max: 5 }) }),
      libres: entier(0, { min: 0, max: 2 }), rangBonus: entier(0, { min: 0, max: 1 }),
      pv: entier(0), pm: entier(0), armure: entier(0, { min: 0 }), regen: entier(0, { min: 0 }),
      rage: new f.BooleanField({ initial: false }), souffle: new f.BooleanField({ initial: false }),
      armeNaturelle: new f.BooleanField({ initial: false }), drain: new f.BooleanField({ initial: false }),
      resist: texte(""),
      comp: new f.ArrayField(new f.SchemaField({ nom: texte(""), carac: choix(R.STATS, "COR"), bonus: entier(10) })),
      conditions: texte(""), traits: texte(""),
      cout: entier(0), budget: entier(R.BUDGET_RACE),
      description: new f.HTMLField({ required: false, initial: "" }),
    };
  }
}

export class CompetenceData extends TypeDataModel {
  static defineSchema() {
    return {
      carac: choix(R.STATS, "ESP"),
      rang: new f.NumberField({ required: true, integer: true, nullable: false, initial: 5, choices: [5, 10, 20] }),
      domaine: texte(""), equivalent: texte(""),
      taille: choix({ precis: "Précis", large: "Large", meta: "Méta" }, "precis"),
      statut: choix({ proposee: "À valider", validee: "Validée", refusee: "Refusée" }, "validee"),
      noteMj: texte(""),
      pouvoir: texte(""),      // famille de pouvoir : magie, divin, psychique, science, technologie (vide = compétence ordinaire)
    };
  }
  prepareDerivedData() { this.bonus = R.bonusEffectif(this.rang, this.taille, this.statut); }
}

export class ArmeData extends TypeDataModel {
  static defineSchema() {
    return { degats: choix(Object.keys(R.COUT_DEGATS_ARME), "1d6"), distance: new f.BooleanField({ initial: false }), equipe: new f.BooleanField({ initial: true }), description: texte("") };
  }
}

export class ArmureData extends TypeDataModel {
  static defineSchema() {
    return { valeur: entier(1, { min: 0, max: 3 }), bouclier: new f.BooleanField({ initial: false }), equipe: new f.BooleanField({ initial: true }), description: texte("") };
  }
}

export class ObjetData extends TypeDataModel {
  static defineSchema() {
    return { usage: texte(""), bonus: new f.NumberField({ required: true, integer: true, nullable: false, initial: 0, choices: [0, 10] }), description: texte("") };
  }
}

export class SortData extends TypeDataModel {
  static defineSchema() {
    return {
      type: choix({ degats: "Dégâts", soin: "Soin", bonus: "Bonus (+20)", malus: "Malus (-20)", armure: "Armure magique (+2)", narratif: "Effet libre" }, "degats"),
      valeur: texte("2d6"), zone: new f.BooleanField({ initial: false }), ampleur: texte(""), description: texte(""),
      discipline: texte(""),   // nom d'une compétence de pouvoir : son bonus s'ajoute au seuil Esprit x 5
    };
  }
  prepareDerivedData() { this.cout = R.coutSort(this); }
}
