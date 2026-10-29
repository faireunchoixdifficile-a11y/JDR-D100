export class D100Actor extends Actor {
  /** Données de jet : @esp, @cor, @pre (valeurs finales) pour l'initiative et les formules. */
  getRollData() {
    const d = super.getRollData();
    const c = this.system?.caracs;
    if (c) Object.assign(d, { cor: c.COR?.value ?? 10, esp: c.ESP?.value ?? 10, pre: c.PRE?.value ?? 10 });
    return d;
  }
}
