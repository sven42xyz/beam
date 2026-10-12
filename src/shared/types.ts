export type ItemKind = 'text' | 'link' | 'file';

/**
 * An item as the server stores and sends it.
 *
 * In encrypted rooms (`enc: true`), `content` (text/link) and `name` (file name,
 * type, original size) are Base64url ciphertext that only devices holding the key
 * can read. `kind` is then only 'text' or 'file'; whether a text is a link is part
 * of the encrypted content.
 */
export interface Item {
  id: string;
  kind: ItemKind;
  createdAt: number;
  enc?: boolean;
  /** text/link */
  content?: string;
  /** file */
  name?: string;
  /** For encrypted files: size of the ciphertext */
  size?: number;
  mime?: string;
}

export type ServerMessage =
  /** maxExpiresAt: creation + maximum lifetime; once expiresAt reaches it, activity no longer extends the room */
  | { type: 'init'; items: Item[]; devices: number; expiresAt: number; maxExpiresAt: number; encrypted: boolean }
  | { type: 'item'; item: Item; expiresAt: number }
  | { type: 'delete'; id: string; expiresAt: number }
  | { type: 'devices'; count: number };
