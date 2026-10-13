export type Row = Record<string, any>;

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters (used for migrations). */
  exec(text: string): Promise<void>;
}
