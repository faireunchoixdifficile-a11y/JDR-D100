/* Importation du contenu D100 (catalogue, bestiaire, bibliothèques et personnages exportés par l'application). */
import { SYSTEM_ID } from "./rules.mjs";

const NOMS = {
  race: "JDR D100 - Races", competence: "JDR D100 - Compétences", arme: "JDR D100 - Armes et armures", armure: "JDR D100 - Armes et armures",
  sort: "JDR D100 - Sorts", objet: "JDR D100 - Objets",
  adversaire: "JDR D100 - Bestiaire", pj: "JDR D100 - Personnages",
};
const COULEURS = { Actor: "#8a2be2", Item: "#1f6f8b" };

async function dossier(nom, type) {
  let f = game.folders.find((x) => x.type === type && x.name === nom && !x.folder);
  if (!f) f = await Folder.create({ name: nom, type, color: COULEURS[type], sorting: "a" });
  return f;
}

/** Crée les documents absents (même nom, même type, même dossier) ; retourne le nombre créé. */
async function creer(classe, lignes, type) {
  if (!lignes?.length) return 0;
  const cree = new Set();
  let n = 0;
  const lots = new Map();
  for (const l of lignes) {
    const nom = NOMS[l.type] ?? NOMS[type];
    const f = await dossier(nom, type);
    const deja = game.collections.get(classe.documentName).filter((d) => d.folder?.id === f.id && d.type === l.type).map((d) => d.name);
    const cle = `${f.id}|${l.type}|${l.name}`;
    if (deja.includes(l.name) || cree.has(cle)) continue;
    cree.add(cle);
    if (!lots.has(f.id)) lots.set(f.id, []);
    lots.get(f.id).push({ ...l, folder: f.id, flags: { [SYSTEM_ID]: { source: "import" } } });
  }
  for (const [, docs] of lots) { await classe.createDocuments(docs); n += docs.length; }
  return n;
}

export async function importerContenu({ silencieux = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Seul le MJ peut importer le contenu.");
  let data;
  try {
    data = await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(`systems/${SYSTEM_ID}/data/contenu.json`));
  } catch (e) {
    console.error(e);
    return ui.notifications.error("JDR D100 : fichier data/contenu.json introuvable. Réexportez le système depuis l'application.");
  }
  const bilan = {};
  bilan.races = await creer(Item, data.races, "Item");
  bilan.competences = await creer(Item, data.competences, "Item");
  bilan.equipement = await creer(Item, [...(data.armes ?? []), ...(data.armures ?? [])], "Item");
  bilan.sorts = await creer(Item, data.sorts, "Item");
  bilan.adversaires = await creer(Actor, data.adversaires, "Actor");
  bilan.personnages = await creer(Actor, data.personnages, "Actor");
  const total = Object.values(bilan).reduce((a, b) => a + b, 0);
  if (!silencieux) ui.notifications.info(total ? `JDR D100 : ${total} élément(s) importé(s) (${bilan.races} races, ${bilan.competences} compétences, ${bilan.equipement} équipements, ${bilan.sorts} sorts, ${bilan.adversaires} adversaires, ${bilan.personnages} personnages).` : "JDR D100 : tout le contenu est déjà présent.");
  return bilan;
}
