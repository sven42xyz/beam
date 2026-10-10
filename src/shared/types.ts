export type ItemKind = 'text' | 'link' | 'file';

/**
 * Ein Eintrag, wie ihn der Server speichert und verschickt.
 *
 * In verschlüsselten Räumen (`enc: true`) sind `content` (Text/Link) und `name`
 * (Dateiname, Typ, Originalgröße) Chiffretext im Base64url-Format, den nur die
 * Geräte mit dem Schlüssel lesen können. `kind` ist dort nur 'text' oder 'file',
 * ob ein Text ein Link ist, steht verschlüsselt im Inhalt.
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
  /** Bei verschlüsselten Dateien: Größe des Chiffretexts */
  size?: number;
  mime?: string;
}

export type ServerMessage =
  | { type: 'init'; items: Item[]; devices: number; expiresAt: number; encrypted: boolean }
  | { type: 'item'; item: Item; expiresAt: number }
  | { type: 'delete'; id: string; expiresAt: number }
  | { type: 'devices'; count: number };
