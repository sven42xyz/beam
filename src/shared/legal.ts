/**
 * Provider details for the Impressum and the privacy policy.
 *
 * § 5 DDG requires a postal address at which legal documents can be served
 * (no P.O. box) and an email address that actually receives mail.
 * contact@chapter42.de is forwarded to a private mailbox by Cloudflare Email Routing.
 *
 * While `ready` is false, the pages are not linked and return 404.
 */
export const LEGAL = {
  ready: true,
  name: 'Sven Siepermann',
  street: 'Junkerstraße 17',
  city: '51588 Nümbrecht',
  country: 'Deutschland',
  email: 'contact@chapter42.de',
  /** Data protection supervisory authority for the state of residence */
  authority: {
    name: 'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen',
    url: 'https://www.ldi.nrw.de',
  },
  /** Date of the current privacy policy */
  updated: '2026-10-13',
  /** Date of the current terms of use */
  termsUpdated: '2026-10-13',
};
