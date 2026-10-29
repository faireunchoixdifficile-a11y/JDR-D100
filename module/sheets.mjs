/* Fiches (ApplicationV2). */
import * as R from "./rules.mjs";
import * as A from "./actions.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
const T = (nom) => `systems/${R.SYSTEM_ID}/templates/${nom}.hbs`;

const options = (liste, valeur) => liste.map(([v, l]) => ({ value: v, label: l, selected: String(v) === String(valeur) }));
const DIFFICULTES = [["facile", "Facile (+20)"], ["normale", "Normale (0)"], ["difficile", "Difficile (−20)"], ["tres_difficile", "Très difficile (−40)"]];
const RANGS = [[5, "Notion (+5)"], [10, "Spécialité (+10)"], [20, "Maîtrise (+20)"]];
const TAILLES = [["precis", "Précis : bonus complet"], ["large", "Large : bonus ÷ 2"], ["meta", "Méta : aucun bonus, −10 à tous les seuils"]];
const STATUTS = [["proposee", "À valider"], ["validee", "Validée"], ["refusee", "Refusée"]];
const TYPES_SORT = [["degats", "Dégâts"], ["soin", "Soin"], ["bonus", "Bonus (+20)"], ["malus", "Malus (−20)"], ["armure", "Armure magique (+2)"], ["narratif", "Effet libre"]];
const AMPLEURS = [["", "—"], ["mineur", "Mineur (1 PM)"], ["moyen", "Moyen (3 PM)"], ["majeur", "Majeur (5 PM)"]];

const itemDe = (sheet, el) => sheet.document.items.get(el.closest("[data-item-id]")?.dataset.itemId);

/** Base commune aux fiches de personnage et d'adversaire. */
class FicheCombattant extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["jdr-d100", "fiche"],
    position: { width: 800, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollStat: FicheCombattant.#rollStat, rollComp: FicheCombattant.#rollComp, rollCompVoisin: FicheCombattant.#rollCompVoisin,
      attaque: FicheCombattant.#attaque, morsure: FicheCombattant.#morsure, souffle: FicheCombattant.#souffle, fuir: FicheCombattant.#fuir,
      couvert: FicheCombattant.#couvert, aider: FicheCombattant.#aider, soigner: FicheCombattant.#soigner, sort: FicheCombattant.#sort,
      desVie: FicheCombattant.#desVie, repos: FicheCombattant.#repos, pause: FicheCombattant.#pause,
      itemEquip: FicheCombattant.#itemEquip, itemCreate: FicheCombattant.#itemCreate, itemEdit: FicheCombattant.#itemEdit, itemDelete: FicheCombattant.#itemDelete,
    },
  };

  static #rollStat(_e, el) { return A.testerCarac(this.document, el.dataset.stat); }
  static #rollComp(_e, el) { return A.testerCompetence(this.document, el.dataset.nom, "plein"); }
  static #rollCompVoisin(_e, el) { return A.testerCompetence(this.document, el.dataset.nom, "voisin"); }
  static #attaque() { return A.attaquer(this.document); }
  static #morsure() { return A.attaquer(this.document, { morsure: true }); }
  static #souffle() { return A.souffler(this.document); }
  static #fuir() { return A.fuir(this.document); }
  static #couvert() { return A.seCouvrir(this.document); }
  static #aider() { return A.aider(this.document); }
  static #soigner() { return A.premiersSecours(this.document); }
  static #sort(_e, el) { const s = itemDe(this, el); return s ? A.lancerSort(this.document, s) : null; }
  static #desVie() { return A.lancerDesVie(this.document); }
  static #repos() { return A.reposComplet(this.document); }
  static #pause() { return A.pauseCourte(this.document); }
  static #itemEquip(_e, el) { const i = itemDe(this, el); return i ? i.update({ "system.equipe": !i.system.equipe }) : null; }
  static #itemEdit(_e, el) { return itemDe(this, el)?.sheet.render(true); }
  static #itemDelete(_e, el) { return itemDe(this, el)?.delete(); }
  static async #itemCreate(_e, el) {
    const type = el.dataset.type;
    const noms = { competence: "Nouvelle compétence", arme: "Nouvelle arme", armure: "Nouvelle armure", objet: "Nouvel objet", sort: "Nouveau sort", race: "Nouvelle race" };
    const [item] = await this.document.createEmbeddedDocuments("Item", [{ name: noms[type] ?? "Nouvel objet", type }]);
    item?.sheet.render(true);
  }

  async _prepareContext(opts) {
    const ctx = await super._prepareContext(opts);
    const actor = this.document, s = actor.system, items = actor.items;
    const par = (t) => items.filter((i) => i.type === t);
    const sur = (i) => ({ id: i.id, name: i.name, img: i.img, system: i.system });
    const rctx = { caracs: { COR: s.caracs.COR.value, ESP: s.caracs.ESP.value, PRE: s.caracs.PRE.value }, competences: s.competencesCtx, raceComp: s.raceComp };
    const competences = par("competence").map((i) => ({ ...sur(i), seuil: R.seuilCompetence(rctx, i.name), voisin: R.seuilCompetence(rctx, i.name, "voisin"),
      tailleTxt: i.system.taille === "precis" ? "" : i.system.taille === "large" ? "large" : "MÉTA", statutTxt: i.system.statut === "validee" ? "" : i.system.statut === "proposee" ? "à valider" : "refusée" }))
      .sort((a, b) => b.system.rang - a.system.rang || a.name.localeCompare(b.name));
    const racesComp = s.raceComp.filter((c) => !competences.some((x) => x.name === c.nom)).map((c) => ({ nom: c.nom, bonus: c.bonus, seuil: R.seuilCompetence(rctx, c.nom) }));
    Object.assign(ctx, {
      actor, system: s, editable: this.isEditable, owner: actor.isOwner,
      stats: R.STATS.map((k) => ({ key: k, nom: R.STAT_NOMS[k], ...s.caracs[k] })),
      competences, racesComp, race: par("race")[0] ? sur(par("race")[0]) : null,
      armes: par("arme").map(sur), armures: par("armure").map(sur), objets: par("objet").map(sur),
      sorts: par("sort").map((i) => ({ ...sur(i), typeTxt: Object.fromEntries(TYPES_SORT)[i.system.type] })),
      difficultes: options(DIFFICULTES, s.reglages?.difficulte),
      rangs: options([["Sbire", "Sbire (1)"], ["Standard", "Standard (2)"], ["Élite", "Élite (4)"], ["Boss", "Boss (8)"]], s.rang),
      statutTxt: { debout: "Debout", inconscient: `Inconscient (meurt dans ${s.etat.tours} round(s))`, stabilise: "Stabilisé (inconscient)", mort: "Mort / hors combat", fuite: "En fuite" }[s.etat.statut],
      pvPct: Math.max(0, Math.min(100, Math.round((s.pv.value / Math.max(1, s.pv.max)) * 100))),
      pmPct: Math.max(0, Math.min(100, Math.round((s.pm.value / Math.max(1, s.pm.max)) * 100))),
      malus: s.malus,
    });
    return ctx;
  }
}

export class PJSheet extends FicheCombattant {
  static DEFAULT_OPTIONS = { ...FicheCombattant.DEFAULT_OPTIONS, classes: ["jdr-d100", "fiche", "pj"] };
  static PARTS = { fiche: { template: T("pj") } };
  get title() { return this.document.name; }

  /** Une seule race par personnage : déposer une race remplace l'ancienne. */
  async _onDropItem(event, item) {
    if (item?.type === "race") for (const r of this.document.items.filter((i) => i.type === "race")) await r.delete();
    return super._onDropItem(event, item);
  }
}

export class AdversaireSheet extends FicheCombattant {
  static DEFAULT_OPTIONS = { ...FicheCombattant.DEFAULT_OPTIONS, classes: ["jdr-d100", "fiche", "adversaire"], position: { width: 640, height: 720 } };
  static PARTS = { fiche: { template: T("adversaire") } };
  get title() { return this.document.name; }
}

export class ObjetSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = { classes: ["jdr-d100", "objet"], position: { width: 520, height: "auto" }, window: { resizable: true }, form: { submitOnChange: true },
    actions: { compAdd: ObjetSheet.#compAdd, compDel: ObjetSheet.#compDel } };
  static PARTS = { objet: { template: T("objet") } };

  static async #compAdd() {
    const c = this.document.system.toObject().comp;
    c.push({ nom: "", carac: "COR", bonus: 10 });
    await this.document.update({ "system.comp": c });
  }
  static async #compDel(_e, el) {
    const c = this.document.system.toObject().comp;
    c.splice(Number(el.dataset.index), 1);
    await this.document.update({ "system.comp": c });
  }
  get title() { return `${this.document.name} (${game.i18n.localize(`TYPES.Item.${this.document.type}`)})`; }

  async _prepareContext(opts) {
    const ctx = await super._prepareContext(opts);
    const item = this.document, s = item.system, t = item.type;
    Object.assign(ctx, {
      item, system: s, type: t, editable: this.isEditable,
      est: { race: t === "race", competence: t === "competence", arme: t === "arme", armure: t === "armure", objet: t === "objet", sort: t === "sort" },
      rangs: options(RANGS, s.rang), tailles: options(TAILLES, s.taille), statuts: options(STATUTS, s.statut),
      caracs: options(R.STATS.map((k) => [k, `${R.STAT_NOMS[k]} (${k})`]), s.carac),
      degatsArme: options(Object.entries(R.COUT_DEGATS_ARME).map(([d, c]) => [d, `${d} (${c} pt)`]), s.degats),
      typesSort: options(TYPES_SORT, s.type), ampleurs: options(AMPLEURS, s.ampleur),
      bonusObjet: options([[0, "Aucun"], [10, "+10 aux tests concernés (1 pt)"]], s.bonus),
      bonusRaceCaracs: R.STATS.map((k) => ({ key: k, nom: R.STAT_NOMS[k] })),
    });
    return ctx;
  }
}
