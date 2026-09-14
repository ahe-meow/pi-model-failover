import { constants } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { Clock, FileSystem } from "../domain/ports.js";

export const nodeFs: FileSystem = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },

  async writeAtomic(path, data, mode) {
    const tempPath = `${path}.tmp`;
    let writeMode = mode;
    try {
      writeMode = (await stat(path)).mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const file = await open(tempPath, "w", writeMode);
    try {
      await file.chmod(writeMode);
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tempPath, path);
  },

  async mkdir(path, mode) {
    await mkdir(path, { recursive: true, mode });
  },

  async tryCreateExclusive(path) {
    try {
      const file = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await file.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },

  async unlink(path) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },

  async mtime(path) {
    try {
      const fileStat = await stat(path);
      return fileStat.mtimeMs;
    } catch {
      return null;
    }
  },
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: async (ms, signal) => {
    if (signal === undefined) {
      await sleep(ms);
    } else {
      await sleep(ms, undefined, { signal });
    }
  },
};
