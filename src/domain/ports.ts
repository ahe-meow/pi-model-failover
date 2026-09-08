export interface FileSystem {
  readText(p: string): Promise<string | null>;
  writeAtomic(p: string, data: string, mode: number): Promise<void>;
  mkdir(p: string, mode: number): Promise<void>;
  tryCreateExclusive(p: string): Promise<boolean>;
  unlink(p: string): Promise<void>;
  mtime(p: string): Promise<number | null>;
}
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export type Fetch = typeof globalThis.fetch;
