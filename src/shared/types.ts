export type ItemKind = 'text' | 'link' | 'file';

export interface Item {
  id: string;
  kind: ItemKind;
  createdAt: number;
  /** text/link */
  content?: string;
  /** file */
  name?: string;
  size?: number;
  mime?: string;
}

export type ServerMessage =
  | { type: 'init'; items: Item[]; devices: number; expiresAt: number }
  | { type: 'item'; item: Item; expiresAt: number }
  | { type: 'delete'; id: string; expiresAt: number }
  | { type: 'devices'; count: number };
