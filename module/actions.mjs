/* Jets et actions de combat. Les règles viennent de rules.mjs (identiques au moteur Python). */
import * as R from "./rules.mjs";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const signe = (n) => (n >= 0 ? `+${n}` : `${n}`);
const parler = (actor) => ChatMessage.getSpeaker({ actor });
const sommeDes = (roll) => roll.dice.reduce((s, d) => s + d.total, 0);
const cibles = () => [...game.user.targets].map((t) => t.actor).filter(Boolean);
const avert = (m) => { ui.notifications.warn(m); return null; };

async function d100() { return new Roll("1d100").evaluate(); }

function etiquetteResultat(t) {
  const cls = t.critique ? "crit-ok" : t.maladresse ? "crit-ko" : t.reussite ? "ok" : "ko";
  return `<span class="d100-res ${cls}">${esc(t.resultat)}</span> <span class="d100-jet">jet ${t.jet} / ${t.effectif}</span>`;
}

function carte(titre, lignes, boutons = "") {
  return `<div class="d100-carte"><h3>${esc(titre)}</h3>${lignes.map((l) => `<p>${l}</p>`).join("")}${boutons ? `<div class="d100-boutons">${boutons}</div>` : ""}</div>`;
}

function bouton(effet, cible, montant, texte, extra = {}) {
  const data = Object.entries({ effet, uuid: cible.uuid, montant, ...extra }).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
  return `<button type="button" class="d100-appliquer" ${data}>${esc(texte)}</button>`;
}

async function publier(actor, html, rolls) {
  return ChatMessage.create({ speaker: parler(actor), content: html, rolls, sound: CONFIG.sounds.dice });
}

/* ------------------------------------------------------------------ tests de compétence et de caractéristique */
function modifGeneral(actor) {
  const r = actor.system.reglages;
  return r ? (R.DIFFICULTES[r.difficulte] ?? 0) + (r.modif ?? 0) : 0;
}

export async function testerSeuil(actor, titre, seuil, modif = modifGeneral(actor)) {
  const roll = await d100();
  const t = R.evaluerTest(seuil, modif, roll.total);
  const lib = modif ? ` (modificateur ${signe(modif)})` : "";
  await publier(actor, carte(`${actor.name} : ${titre}`, [`Seuil ${seuil}${lib} → ${etiquetteResultat(t)}`]), [roll]);
  return t;
}

export function testerCompetence(actor, nom, mode = "plein") {
  const s = actor.system;
  const seuil = R.seuilCompetence({ caracs: actor.type === "pj" ? s.persoCaracs() : { COR: s.caracs.COR.value, ESP: s.caracs.ESP.value, PRE: s.caracs.PRE.value }, competences: s.competencesCtx, raceComp: s.raceComp }, nom, mode, "ESP");
  return testerSeuil(actor, mode === "voisin" ? `${nom} (domaine voisin)` : nom, seuil);
}

export function testerCarac(actor, stat) {
  return testerSeuil(actor, `${R.STAT_NOMS[stat]} (${stat})`, actor.system.caracs[stat].seuil);
}

/* ------------------------------------------------------------------ états et effets */
async function majEtat(actor, champs) {
  const upd = {};
  for (const [k, v] of Object.entries(champs)) upd[`system.etat.${k}`] = v;
  if (actor.isOwner) await actor.update(upd);
}

async function statut(actor, id, active, overlay = false) {
  try { await actor.toggleStatusEffect(id, { active, overlay }); } catch (e) { console.debug("jdr-d100 | statut ignoré", id, e); }
}

export async function infliger(actor, dmg) {
  const s = actor.system, pv = s.pv.value - dmg, upd = { "system.pv.value": pv };
  let msg = "";
  if (pv <= 0) {
    if (actor.type === "adversaire") {
      if (s.etat.statut !== "mort") { upd["system.etat.statut"] = "mort"; msg = `${actor.name} est hors combat.`; }
    } else if (["debout", "stabilise"].includes(s.etat.statut)) {
      const r = await new Roll("1d4").evaluate();
      upd["system.etat.statut"] = "inconscient"; upd["system.etat.tours"] = r.total;
      msg = `${actor.name} tombe inconscient (meurt dans ${r.total} round(s) sans soin).`;
    }
  }
  await actor.update(upd);
  if (upd["system.etat.statut"] === "mort") await statut(actor, "dead", true, true);
  if (upd["system.etat.statut"] === "inconscient") await statut(actor, "unconscious", true);
  return msg;
}

export async function soignerPV(actor, gain) {
  const s = actor.system;
  if (["inconscient", "stabilise"].includes(s.etat.statut)) {
    await actor.update({ "system.pv.value": Math.min(s.pv.max, gain), "system.etat.statut": "debout", "system.etat.tours": 0 });
    await statut(actor, "unconscious", false);
    return `${actor.name} +${gain} PV et reprend conscience.`;
  }
  await actor.update({ "system.pv.value": Math.min(s.pv.max, s.pv.value + gain) });
  return `${actor.name} +${gain} PV.`;
}

/** Effet d'un bouton de carte de chat (le MJ ou le propriétaire de la cible les applique). */
export async function appliquerEffet(d) {
  const actor = await fromUuid(d.uuid);
  if (!actor) return ui.notifications.warn("Cible introuvable.");
  if (!actor.isOwner) return ui.notifications.warn("Seul le MJ (ou le propriétaire de la cible) peut appliquer cet effet.");
  const m = Number(d.montant) || 0;
  let msg = "";
  switch (d.effet) {
    case "degats":
      msg = `${actor.name} subit ${m} dégât(s) : ${await infliger(actor, m)}`.trim();
      if (d.drain) {
        const src = await fromUuid(d.drain);
        if (src && m > 0) { const g = Math.min(m, src.system.pv.max - src.system.pv.value); if (g > 0) { await src.update({ "system.pv.value": src.system.pv.value + g }); msg += ` ${src.name} récupère ${g} PV.`; } }
      }
      break;
    case "soin": msg = await soignerPV(actor, m); break;
    case "premiers-secours":
      if (actor.system.etat.statut === "inconscient") { await actor.update({ "system.pv.value": 0, "system.etat.statut": "stabilise", "system.etat.tours": 0 }); msg = `${actor.name} est stabilisé (reste inconscient).`; }
      else if (actor.system.etat.soigne) msg = `${actor.name} a déjà été soigné lors de ce combat.`;
      else { msg = await soignerPV(actor, m); await majEtat(actor, { soigne: true }); }
      break;
    case "aide": await majEtat(actor, { aide: Math.max(actor.system.etat.aide, m) }); msg = `${actor.name} : +${m} à sa prochaine attaque.`; break;
    case "malus": await majEtat(actor, { malus: m }); msg = `${actor.name} : -${m} à sa prochaine attaque.`; break;
    case "armure":
      if (actor.system.etat.protege) msg = `${actor.name} est déjà protégé.`;
      else { await majEtat(actor, { protege: true }); msg = `${actor.name} : +${R.ARMURE_SORT} d'armure jusqu'à la fin du combat.`; }
      break;
    default: return;
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker(), content: `<div class="d100-carte"><p>${esc(msg)}</p></div>` });
}

/* ------------------------------------------------------------------ actions de combat */
function listeResist(actor) { return String(actor.system.traits?.resist ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); }
const elementDe = (actor) => (actor.type === "adversaire" ? String(actor.system.element || "").trim().toLowerCase() : "");

async function lanceDes(formule) {
  const roll = await new Roll(formule).evaluate();
  return { roll, total: roll.total, sommeDes: sommeDes(roll) };
}

export async function attaquer(actor, { morsure = false } = {}) {
  const s = actor.system, e = s.etat;
  if (morsure && !s.traits.armeNaturelle) return avert(`${actor.name} n'a pas d'arme naturelle.`);
  const cible = cibles()[0] ?? null;
  const bd = s.bonusDegats;
  let seuil, formule, lib;
  if (morsure) { seuil = s.caracs.COR.value * 5 - s.malus; formule = R.DEGATS_MORSURE + (bd ? `+${bd}` : ""); lib = "mord"; }
  else if (actor.type === "pj") { seuil = s.attaque; formule = s.arme.degats + (bd ? `+${bd}` : ""); lib = "attaque"; }
  else { seuil = s.attaque; formule = s.degats; lib = "attaque"; }
  const lignes = [];
  const maj = { couvert: false };
  if (!morsure) {
    if (s.traits.rage && !e.rageUtilisee) { maj.rageUtilisee = true; maj.rageAttaques = 3; lignes.push(`<em>${esc(actor.name)} entre en RAGE (+${R.MALUS_RAGE} aux 3 prochaines attaques).</em>`); }
    const restantes = maj.rageAttaques ?? e.rageAttaques;
    if (restantes > 0) { seuil += R.MALUS_RAGE; maj.rageAttaques = restantes - 1; }
  }
  const extra = e.aide - e.malus; maj.aide = 0; maj.malus = 0;
  const distance = !morsure && (actor.type === "pj" ? s.arme?.distance : s.distance);
  const modif = R.modifOffensif({ defenseCible: cible?.system.defense ?? 0, extra, tireur: !!distance, cibleCouverte: !!cible?.system.etat.couvert });
  const roll = await d100();
  const t = R.evaluerTest(seuil, modif, roll.total);
  await majEtat(actor, maj);
  const rolls = [roll];
  const cibleTxt = cible ? ` ${esc(cible.name)}` : "";
  lignes.push(`${esc(actor.name)} ${lib}${cibleTxt} : seuil ${seuil}${modif ? ` (${signe(modif)}${cible ? `, défense ${cible.system.defense}` : ""})` : ""} → ${etiquetteResultat(t)}`);
  let boutons = "";
  if (t.reussite) {
    const d = await lanceDes(formule);
    rolls.push(d.roll);
    const dmg = R.degatsAttaque({ total: d.total, sommeDes: d.sommeDes, critique: t.critique, armure: cible?.system.armure ?? 0, resiste: !!(cible && elementDe(actor) && listeResist(cible).includes(elementDe(actor))) });
    lignes.push(`Dégâts ${esc(formule)} : ${d.total}${t.critique ? ` + ${d.sommeDes} (critique)` : ""}${cible ? ` − armure ${cible.system.armure}` : ""} = <strong>${dmg}</strong>`);
    if (cible) boutons = bouton("degats", cible, dmg, `Appliquer ${dmg} dégât(s) à ${cible.name}`, morsure && s.traits.drain ? { drain: actor.uuid } : {});
    else lignes.push("<em>Aucune cible : ciblez un jeton (touche T) pour appliquer les dégâts.</em>");
  } else if (t.maladresse) lignes.push("<em>Maladresse : à décrire.</em>");
  return publier(actor, carte(lib === "mord" ? "Morsure" : "Attaque", lignes, boutons), rolls);
}

export async function lancerSort(actor, sort) {
  const s = actor.system, sp = sort.system, cout = sp.cout;
  if (s.pm.value < cout) return avert(`${actor.name} n'a pas assez de PM pour « ${sort.name} » (${cout} PM).`);
  const offensif = ["degats", "malus"].includes(sp.type);
  let cs = cibles();
  if (!offensif && sp.type !== "narratif" && !cs.length) cs = [actor];
  if (offensif && !cs.length) return avert("Ce sort demande un ennemi pour cible : ciblez un jeton (touche T).");
  if (!sp.zone) cs = cs.slice(0, 1);
  const e = s.etat, extra = e.aide - e.malus;
  await actor.update({ "system.pm.value": s.pm.value - cout, "system.etat.couvert": false, "system.etat.aide": 0, "system.etat.malus": 0 });
  const lignes = [`${esc(actor.name)} lance « ${esc(sort.name)} » (${cout} PM)${sp.zone ? " en zone" : ""}`];
  const rolls = [];
  let boutons = "";
  const seuil = s.caracs.ESP.value * 5 - s.malus;
  const sansCible = sp.type === "narratif" ? [null] : cs;
  for (const c of sansCible) {
    const modif = offensif ? R.modifOffensif({ defenseCible: c.system.defense, extra, tireur: true, cibleCouverte: !!c.system.etat.couvert }) : extra;
    const roll = await d100(); rolls.push(roll);
    const t = R.evaluerTest(seuil, modif, roll.total);
    const nom = c ? esc(c.name) : "";
    if (!t.reussite) { lignes.push(`${nom ? `sur ${nom} : ` : ""}${etiquetteResultat(t)} → le sort échoue`); continue; }
    if (sp.type === "degats") {
      const d = await lanceDes(sp.valeur); rolls.push(d.roll);
      const dmg = R.degatsSort({ total: d.total, sommeDes: d.sommeDes, critique: t.critique, zone: sp.zone, resiste: !!(elementDe(actor) && listeResist(c).includes(elementDe(actor))) });
      lignes.push(`sur ${nom} : ${etiquetteResultat(t)} → <strong>${dmg}</strong> dégâts (armure ignorée)`);
      boutons += bouton("degats", c, dmg, `${dmg} dégât(s) à ${c.name}`);
    } else if (sp.type === "soin") {
      const d = await lanceDes(sp.valeur); rolls.push(d.roll);
      const gain = R.soinSort({ total: d.total, sommeDes: d.sommeDes, critique: t.critique, zone: sp.zone });
      lignes.push(`sur ${nom} : ${etiquetteResultat(t)} → soin <strong>${gain}</strong>`);
      boutons += bouton("soin", c, gain, `Soigner ${c.name} (+${gain})`);
    } else if (sp.type === "malus") {
      lignes.push(`sur ${nom} : ${etiquetteResultat(t)} → −${R.MALUS_SORT} à sa prochaine attaque`);
      boutons += bouton("malus", c, R.MALUS_SORT, `Malus sur ${c.name}`);
    } else if (sp.type === "bonus") {
      lignes.push(`sur ${nom} : ${etiquetteResultat(t)} → +${R.BONUS_SORT} à sa prochaine attaque`);
      boutons += bouton("aide", c, R.BONUS_SORT, `Bonus pour ${c.name}`);
    } else if (sp.type === "armure") {
      lignes.push(`sur ${nom} : ${etiquetteResultat(t)} → +${R.ARMURE_SORT} d'armure jusqu'à la fin du combat`);
      boutons += bouton("armure", c, R.ARMURE_SORT, `Protéger ${c.name}`);
    } else lignes.push(`${etiquetteResultat(t)} → effet « ${esc(sp.ampleur || "libre")} » réussi : à décrire.${sp.description ? ` ${esc(sp.description)}` : ""}`);
  }
  return publier(actor, carte(sort.name, lignes, boutons), rolls);
}

export async function souffler(actor) {
  const s = actor.system;
  if (!s.traits.souffle || s.etat.souffleUtilise) return avert(`${actor.name} ne peut pas utiliser son souffle.`);
  const cible = cibles()[0];
  if (!cible) return avert("Ciblez un jeton (touche T).");
  await majEtat(actor, { souffleUtilise: true, couvert: false });
  const esq = await d100();
  const t = R.evaluerTest(cible.system.caracs.COR.value * 5 - cible.system.malus, 0, esq.total);
  const lignes = [`${esc(actor.name)} souffle sur ${esc(cible.name)} : esquive → ${etiquetteResultat(t)}`];
  const rolls = [esq]; let boutons = "";
  if (!t.reussite) {
    const d = await lanceDes(R.DEGATS_SOUFFLE); rolls.push(d.roll);
    const dmg = R.degatsSort({ total: d.total, sommeDes: 0, critique: false, zone: false, resiste: !!(elementDe(actor) && listeResist(cible).includes(elementDe(actor))) });
    lignes.push(`Esquive ratée : <strong>${dmg}</strong> dégâts`);
    boutons = bouton("degats", cible, dmg, `${dmg} dégât(s) à ${cible.name}`);
  }
  return publier(actor, carte("Souffle", lignes, boutons), rolls);
}

export async function fuir(actor) {
  await majEtat(actor, { couvert: false });
  const roll = await d100();
  const t = R.evaluerTest(actor.system.seuilFuite, 0, roll.total);
  const lignes = [`${esc(actor.name)} tente de fuir : seuil ${actor.system.seuilFuite} → ${etiquetteResultat(t)}`];
  if (t.reussite) { await majEtat(actor, { statut: "fuite" }); lignes.push("Il s'enfuit."); }
  else lignes.push("Échec : <strong>attaque gratuite</strong> d'un poursuivant (le MJ la joue).");
  return publier(actor, carte("Fuite", lignes), [roll]);
}

export async function seCouvrir(actor) {
  await majEtat(actor, { couvert: true });
  return ChatMessage.create({ speaker: parler(actor), content: carte("À couvert", [`${esc(actor.name)} se met à couvert (−${R.MALUS_COUVERT} contre les tirs et les sorts) jusqu'à sa prochaine action.`]) });
}

export async function aider(actor) {
  const cible = cibles()[0];
  if (!cible || cible === actor) return avert("Ciblez un allié (pas vous-même).");
  await majEtat(actor, { couvert: false });
  const s = actor.system, roll = await d100();
  const t = R.evaluerTest(Math.max(s.caracs.COR.value, s.caracs.ESP.value) * 5 - s.malus, 0, roll.total);
  const lignes = [`${esc(actor.name)} aide ${esc(cible.name)} → ${etiquetteResultat(t)}`];
  const b = t.reussite ? bouton("aide", cible, R.BONUS_AIDE, `+${R.BONUS_AIDE} pour ${cible.name}`) : "";
  return publier(actor, carte("Aider", lignes, b), [roll]);
}

export async function premiersSecours(actor) {
  const cible = cibles()[0];
  if (!cible || cible === actor) return avert("Ciblez un allié (on ne se soigne pas soi-même avec Premiers secours).");
  if (["mort", "fuite"].includes(cible.system.etat.statut)) return avert("Cette cible ne peut pas être soignée.");
  await majEtat(actor, { couvert: false });
  const s = actor.system;
  const seuil = actor.type === "pj" ? R.seuilCompetence({ caracs: s.persoCaracs(), competences: s.competencesCtx, raceComp: s.raceComp }, "Premiers secours", "plein", "ESP") : s.caracs.ESP.value * 5;
  const roll = await d100();
  const t = R.evaluerTest(seuil, 0, roll.total);
  const lignes = [`${esc(actor.name)} soigne ${esc(cible.name)} : seuil ${seuil} → ${etiquetteResultat(t)}`];
  const rolls = [roll]; let b = "";
  if (t.reussite) {
    if (cible.system.etat.statut === "inconscient") { lignes.push(`${esc(cible.name)} peut être <strong>stabilisé</strong> (il ne mourra plus, mais reste inconscient).`); b = bouton("premiers-secours", cible, 0, `Stabiliser ${cible.name}`); }
    else { const d = await lanceDes(t.critique ? "2d6" : R.DEGATS_SOIN); rolls.push(d.roll); lignes.push(`Soin : <strong>${d.total}</strong> PV`); b = bouton("premiers-secours", cible, d.total, `Soigner ${cible.name} (+${d.total})`); }
  }
  return publier(actor, carte("Premiers secours", lignes, b), rolls);
}

/* ------------------------------------------------------------------ création et repos */
export async function lancerDesVie(actor) {
  const a = await new Roll("1d10").evaluate(), b = await new Roll("1d10").evaluate();
  await actor.update({ "system.pvDe": a.total, "system.pmDe": b.total });
  await actor.update({ "system.pv.value": actor.system.pv.max, "system.pm.value": actor.system.pm.max });
  await ChatMessage.create({ speaker: parler(actor), rolls: [a, b], content: carte("Points de vie et de magie", [`${esc(actor.name)} : PV = COR × 2 + 1d10 (${a.total}) → <strong>${actor.system.pv.max}</strong> ; PM = ESP + PRE + 1d10 (${b.total}) → <strong>${actor.system.pm.max}</strong>`]) });
}

export async function reposComplet(actor) {
  await actor.update({ "system.pv.value": actor.system.pv.max, "system.pm.value": actor.system.pm.max, "system.etat.statut": "debout", "system.etat.tours": 0,
    "system.etat.aide": 0, "system.etat.malus": 0, "system.etat.couvert": false, "system.etat.protege": false, "system.etat.rageUtilisee": false,
    "system.etat.rageAttaques": 0, "system.etat.souffleUtilise": false, "system.etat.soigne": false });
  await statut(actor, "unconscious", false); await statut(actor, "dead", false);
  return ChatMessage.create({ speaker: parler(actor), content: carte("Repos", [`${esc(actor.name)} se repose : PV et PM au maximum.`]) });
}

export async function pauseCourte(actor) {
  const d = await new Roll(R.DEGATS_SOIN).evaluate();
  const gain = Math.min(d.total, actor.system.pv.max - actor.system.pv.value);
  await actor.update({ "system.pv.value": actor.system.pv.value + gain });
  return ChatMessage.create({ speaker: parler(actor), rolls: [d], content: carte("Pause courte", [`${esc(actor.name)} récupère ${gain} PV.`]) });
}

/** Remise à zéro de l'état de combat (fin de combat). */
export async function finDeCombat(actor) {
  if (!actor?.isOwner) return;
  await actor.update({ "system.etat.aide": 0, "system.etat.malus": 0, "system.etat.couvert": false, "system.etat.protege": false,
    "system.etat.rageUtilisee": false, "system.etat.rageAttaques": 0, "system.etat.souffleUtilise": false, "system.etat.soigne": false });
}

/** Début d'un nouveau round : régénération et compte à rebours des inconscients. */
export async function nouveauRound(actor) {
  const s = actor.system, e = s.etat;
  if (s.pv.value > 0 && !["mort", "fuite"].includes(e.statut) && s.regen && s.pv.value < s.pv.max) {
    const g = Math.min(s.regen, s.pv.max - s.pv.value);
    await actor.update({ "system.pv.value": s.pv.value + g });
    await ChatMessage.create({ speaker: parler(actor), content: carte("Régénération", [`${esc(actor.name)} régénère ${g} PV.`]) });
  }
  if (actor.type === "pj" && e.statut === "inconscient") {
    const t = e.tours - 1;
    if (t <= 0) { await actor.update({ "system.etat.statut": "mort", "system.etat.tours": 0 }); await statut(actor, "dead", true, true); await ChatMessage.create({ speaker: parler(actor), content: carte("Mort", [`${esc(actor.name)} succombe à ses blessures.`]) }); }
    else await actor.update({ "system.etat.tours": t });
  }
}
