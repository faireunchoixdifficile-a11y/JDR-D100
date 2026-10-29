/* JDR D100 : système pour Foundry VTT v14. Généré par l'application JDR D100 (jdr_foundry.py). */
import * as R from "./rules.mjs";
import * as A from "./actions.mjs";
import { PJData, AdversaireData, RaceData, CompetenceData, ArmeData, ArmureData, ObjetData, SortData } from "./data.mjs";
import { D100Actor } from "./documents.mjs";
import { PJSheet, AdversaireSheet, ObjetSheet } from "./sheets.mjs";
import { importerContenu } from "./importer.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.documentClass = D100Actor;
  CONFIG.Actor.dataModels = { pj: PJData, adversaire: AdversaireData };
  CONFIG.Item.dataModels = { race: RaceData, competence: CompetenceData, arme: ArmeData, armure: ArmureData, objet: ObjetData, sort: SortData };
  CONFIG.Actor.trackableAttributes = { pj: { bar: ["pv", "pm"], value: [] }, adversaire: { bar: ["pv", "pm"], value: [] } };
  CONFIG.Combat.initiative = { formula: "1d10 + @esp", decimals: 0 };

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, R.SYSTEM_ID, PJSheet, { types: ["pj"], makeDefault: true, label: "Fiche JDR D100" });
  DocumentSheetConfig.registerSheet(Actor, R.SYSTEM_ID, AdversaireSheet, { types: ["adversaire"], makeDefault: true, label: "Adversaire JDR D100" });
  DocumentSheetConfig.registerSheet(Item, R.SYSTEM_ID, ObjetSheet, { makeDefault: true, label: "Objet JDR D100" });

  Handlebars.registerHelper("d100eq", (a, b) => a === b);
  Handlebars.registerHelper("d100pos", (n) => Number(n) > 0);

  game.settings.register(R.SYSTEM_ID, "importPropose", { scope: "world", config: false, type: Boolean, default: false });
  game.jdrd100 = { regles: R, actions: A, importerContenu };
});

/** Boutons des cartes de chat : appliquer dégâts, soins et effets (MJ ou propriétaire de la cible). */
Hooks.on("renderChatMessageHTML", (_message, html) => {
  for (const b of html.querySelectorAll(".d100-appliquer")) {
    b.addEventListener("click", (ev) => { ev.preventDefault(); A.appliquerEffet({ ...b.dataset }); });
  }
});

/** Bouton d'importation dans l'annuaire des acteurs. */
Hooks.on("renderActorDirectory", (_app, html) => {
  if (!game.user.isGM || html.querySelector(".d100-import")) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "d100-import";
  b.innerHTML = '<i class="fa-solid fa-dice-d20"></i> Importer le contenu D100';
  b.title = "Races, compétences, armes, sorts, bestiaire et personnages exportés par l'application";
  b.addEventListener("click", () => importerContenu());
  (html.querySelector(".header-actions") ?? html.querySelector(".directory-header") ?? html).prepend(b);
});

/** Premier lancement du monde : proposer l'importation du contenu. */
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.settings.get(R.SYSTEM_ID, "importPropose")) return;
  await game.settings.set(R.SYSTEM_ID, "importPropose", true);
  const oui = await foundry.applications.api.DialogV2.confirm({
    window: { title: "JDR D100" },
    content: "<p>Importer le contenu du système (races, compétences, armes, sorts, bestiaire de 49 adversaires, vos personnages exportés) ?</p><p>Vous pourrez le refaire plus tard avec le bouton « Importer le contenu D100 » de l'onglet Acteurs.</p>",
    yes: { label: "Importer", default: true }, no: { label: "Plus tard" },
  });
  if (oui) await importerContenu();
});

/** Combat : régénération et compte à rebours des inconscients à chaque round ; remise à zéro en fin de combat. */
Hooks.on("combatRound", (combat) => {
  if (!game.user.isActiveGM) return;
  for (const c of combat.combatants) if (c.actor) A.nouveauRound(c.actor);
});
Hooks.on("deleteCombat", (combat) => {
  if (!game.user.isActiveGM) return;
  for (const c of combat.combatants) A.finDeCombat(c.actor);
});
