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
  ready: true,
  name: 'Sven Siepermann',
  street: 'Junkerstraße 17',
  city: '51588 Nümbrecht',
  country: 'Deutschland',
  email: 'sven.siepermann99@gmail.com',
  /** Zuständige Datenschutz-Aufsichtsbehörde (Bundesland des Wohnsitzes) */
  authority: {
    name: 'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen',
    url: 'https://www.ldi.nrw.de',
  },
  /** Stand der Datenschutzerklärung */
  updated: '2026-10-10',
};
