// New codes: no look-alike characters (0/O, 1/I/L) and no vowels (A, E, U),
// so they cannot spell offensive words. 28^6 ≈ 481 million combinations.
export const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;

// The old alphabet with A, E, U is still accepted, so existing rooms stay reachable
const ACCEPTED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp(`^[${ACCEPTED_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateCode(): string {
  // Rejection sampling keeps the distribution uniform
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

/** Uppercases and strips spaces and dashes. Returns null if invalid. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}
