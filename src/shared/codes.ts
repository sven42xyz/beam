// Neue Codes: ohne verwechselbare Zeichen (0/O, 1/I/L) und ohne Vokale (A, E, U),
// damit keine anstößigen Wörter entstehen. 28^6 ≈ 481 Mio. Kombinationen.
export const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;

// Akzeptiert wird weiterhin das alte Alphabet mit A, E, U, damit bestehende Räume erreichbar bleiben
const ACCEPTED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp(`^[${ACCEPTED_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateCode(): string {
  // Rejection Sampling, damit die Verteilung gleichmäßig bleibt
  const max = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
    for (const b of bytes) {
      if (b < max && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/** Großschreibung, Leer- und Trennzeichen entfernen. Gibt null zurück, wenn ungültig. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}
