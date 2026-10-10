/**
 * Angaben für Impressum und Datenschutzerklärung.
 *
 * § 5 DDG verlangt eine ladungsfähige Postanschrift (kein Postfach) und eine
 * E-Mail-Adresse, die tatsächlich Post annimmt. chapter42.de hat einen Null-MX,
 * die Adresse muss also auf einer anderen Domain liegen.
 *
 * Solange `ready` false ist, werden die Seiten nicht verlinkt und liefern 404.
 */
export const LEGAL = {
  ready: false,
  name: 'TODO: Vor- und Nachname',
  street: 'TODO: Straße und Hausnummer',
  city: 'TODO: PLZ und Ort',
  country: 'Deutschland',
  email: 'TODO: kontakt@example.com',
  /** Zuständige Datenschutz-Aufsichtsbehörde (Bundesland des Wohnsitzes) */
  authority: {
    name: 'TODO: Landesbeauftragte/r für Datenschutz',
    url: 'https://www.datenschutzkonferenz-online.de/datenschutzaufsichtsbehoerden.html',
  },
  /** Stand der Datenschutzerklärung */
  updated: '2026-10-10',
};
