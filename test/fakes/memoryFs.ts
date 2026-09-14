import type { FileSystem } from "../../src/domain/ports.js";

export class MemoryFs implements FileSystem {
  files = new Map<string, string>();
  modes = new Map<string, number>();
  mtimes = new Map<string, number>();
  now = 1_000;

  async readText(p: string) {
    return this.files.get(p) ?? null;
  }

  async writeAtomic(p: string, data: string, mode: number) {
    const existingMode = this.files.has(p) ? (this.modes.get(p) ?? mode) : mode;
    this.files.set(p, data);
    this.modes.set(p, existingMode);
    this.mtimes.set(p, this.now);
  }

  async mkdir(p: string, mode: number) {
    this.modes.set(p, mode);
  }

  async tryCreateExclusive(p: string) {
    if (this.files.has(p)) return false;
    this.files.set(p, "");
    this.mtimes.set(p, this.now);
    return true;
  }

  async unlink(p: string) {
    this.files.delete(p);
    this.modes.delete(p);
    this.mtimes.delete(p);
  }

  async mtime(p: string) {
    return this.mtimes.get(p) ?? null;
  }
}
