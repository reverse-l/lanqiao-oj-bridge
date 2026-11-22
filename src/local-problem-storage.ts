import {watch} from 'node:fs';
import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import type {LocalProblem, LocalProblemStorage} from './local-problems';

// Use VSCode's profile-local extension directory, independently of the shared Memento blob.
export class LocalProblemFileStorage implements LocalProblemStorage {
  private readonly file: string;
  private readonly lock: string;

  constructor(private readonly directory: string) {
    this.file = path.join(directory, 'local-problems.json');
    this.lock = this.file + '.lock';
  }

  async read(): Promise<unknown> {
    const content = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('本地题目索引格式无效');
    return parsed;
  }

  async write(records: LocalProblem[]): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(records), {flag: 'wx', mode: 0o600});
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, {recursive: true});
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        const handle = await open(this.lock, 'wx', 0o600);
        try {
          await handle.close();
        } catch (error) {
          await unlink(this.lock);
          throw error;
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error(`本地题目索引被占用，请重试。若所有 VSCode 窗口完全退出后仍无法恢复，可删除锁文件 ${this.lock}`);
        await delay(40);
      }
    }
    try { return await action(); }
    finally { await unlink(this.lock); }
  }

  async watchChanges(change: () => void, onError: (error: unknown) => void): Promise<{dispose(): void}> {
    await mkdir(this.directory, {recursive: true});
    const watcher = watch(this.directory, {persistent: false}, (_event, filename) => {
      if (!filename || filename === path.basename(this.file)) change();
    });
    watcher.on('error', onError);
    return {dispose: () => watcher.close()};
  }
}
