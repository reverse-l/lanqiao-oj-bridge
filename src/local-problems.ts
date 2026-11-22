import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {languageOfSource, type LanguageId} from './languages';
import {normalizeCourseUrl, problemId, validateProblem, type Problem, type ProblemSource} from './problem';
import {findProblemSource, rejectSymlinks} from './storage';

const STATUS_BY_VERDICT = new Map([
  ['AC', 'accepted'], ['WA', 'wrong_answer'], ['TLE', 'time_limit_exceeded'],
  ['MLE', 'memory_limit_exceeded'], ['RE', 'runtime_error'], ['CE', 'compile_error'],
] as const);
type KnownStatus = typeof STATUS_BY_VERDICT extends Map<string, infer T> ? T : never;
export type ProblemStatus = 'not_submitted' | KnownStatus | 'other';
type VerdictCode = Parameters<typeof STATUS_BY_VERDICT.get>[0];
const STATUSES = new Set<ProblemStatus>(['not_submitted', 'other', ...STATUS_BY_VERDICT.values()]);

export interface LocalProblem {
  key: string;
  id: string;
  title: string;
  source: ProblemSource;
  sourceUrl: string;
  sourceConfirmed?: boolean;
  localFilePath: string;
  markdownFilePath?: string;
  tags: string[];
  importedAt: number;
  updatedAt: number;
  status: ProblemStatus;
  lastSubmittedAt?: number;
  lastAcceptedAt?: number;
  officialStatus?: string;
}

export interface LocalProblemStorage {
  read(): Promise<unknown>;
  write(records: LocalProblem[]): Promise<void>;
  withLock<T>(action: () => Promise<T>): Promise<T>;
}

interface ResultEvent {
  kind: string;
  problemId: string;
  problemSource?: string;
  state: string;
  created: number;
  result?: {phase: string; status?: string; submissionId?: string};
}

type ProblemIdentity = Pick<LocalProblem, 'key' | 'id' | 'title' | 'source' | 'sourceUrl'>;
type Entry = ProblemIdentity & Pick<LocalProblem, 'localFilePath' | 'markdownFilePath' | 'importedAt'> & {inferredSource?: boolean};
export interface MigrationResult {found: number; added: number; skipped: number}

export function normalizeTags(tags: readonly unknown[]): string[] {
  const result = new Map<string, string>();
  for (const value of tags) {
    if (typeof value !== 'string') continue;
    const tag = value.trim();
    if (tag && !result.has(tag.toLowerCase())) result.set(tag.toLowerCase(), tag);
  }
  return [...result.values()];
}

function sourceUrl(source: ProblemSource, id: string, url: string): string {
  if (source === 'lanqiao-course') return normalizeCourseUrl(url);
  if (problemId(url) !== id) throw new Error('题号与网址不一致');
  return `${new URL(url).origin}/problems/${id}/learning/`;
}

function markdownPath(value: unknown): string | undefined {
  if (typeof value === 'string' && path.isAbsolute(value) && path.extname(value).toLowerCase() === '.md') return path.normalize(value);
}

function entry(problem: Problem, localFilePath: string, importedAt?: number, statement?: string): Entry {
  const source = problem.courseUrl ? 'lanqiao-course' : 'lanqiao-oj';
  return {
    key: `${source}:${problem.id}`, id: problem.id, title: problem.title, source,
    sourceUrl: sourceUrl(source, problem.id, problem.courseUrl ?? problem.url),
    localFilePath: path.resolve(localFilePath), importedAt: importedAt ?? Date.now(),
    markdownFilePath: markdownPath(statement), inferredSource: !problem.courseUrl && !problem.source,
  };
}

function readRecords(value: unknown): Map<string, LocalProblem> {
  const records = new Map<string, LocalProblem>();
  if (!Array.isArray(value)) return records;
  for (const item of value) {
    const p = item as Partial<LocalProblem> | null;
    if (!p || typeof p.id !== 'string' || !/^\d{1,10}$/.test(p.id) || typeof p.title !== 'string' ||
      (p.source !== 'lanqiao-oj' && p.source !== 'lanqiao-course') || typeof p.sourceUrl !== 'string' ||
      p.key !== `${p.source}:${p.id}` || typeof p.localFilePath !== 'string' || !path.isAbsolute(p.localFilePath) ||
      !languageOfSource(p.localFilePath) || !p.status || !STATUSES.has(p.status) ||
      typeof p.importedAt !== 'number' || !Number.isFinite(p.importedAt) ||
      typeof p.updatedAt !== 'number' || !Number.isFinite(p.updatedAt)) continue;
    try {
      records.set(p.key, {...p, sourceUrl: sourceUrl(p.source, p.id, p.sourceUrl),
        markdownFilePath: markdownPath(p.markdownFilePath),
        lastAcceptedAt: Number.isFinite(p.lastAcceptedAt) ? p.lastAcceptedAt : undefined,
        lastSubmittedAt: Number.isFinite(p.lastSubmittedAt) ? p.lastSubmittedAt : undefined,
        tags: normalizeTags(Array.isArray(p.tags) ? p.tags : []),
      } as LocalProblem);
    } catch { /* Ignore invalid records in local storage. */ }
  }
  return records;
}

function resultUpdate(job: ResultEvent) {
  const result = job.result;
  const officialStatus = typeof result?.status === 'string' ? result.status.trim().slice(0, 80) : '';
  if (job.kind !== 'submit' || job.state !== 'finished' || result?.phase !== 'done' || !officialStatus ||
    typeof result.submissionId !== 'string' || !result.submissionId.trim() || !Number.isFinite(job.created)) return;
  return {
    id: job.problemId, source: job.problemSource, at: job.created, officialStatus,
    status: STATUS_BY_VERDICT.get(officialStatus.toUpperCase() as VerdictCode) ?? 'other' as const,
  };
}

function applyResult(records: Map<string, LocalProblem>, result: NonNullable<ReturnType<typeof resultUpdate>>, only?: Set<string>): boolean {
  const matching = result.source ? [records.get(`${result.source}:${result.id}`)] :
    [...records.values()].filter(p => p.id === result.id);
  const p = matching.length === 1 ? matching[0] : undefined;
  if (!p || (only && !only.has(p.key))) return false;
  const later = result.at > (p.lastSubmittedAt ?? -1) ||
    (result.at === p.lastSubmittedAt && result.officialStatus !== p.officialStatus);
  const lastAcceptedAt = result.status === 'accepted' ? Math.max(result.at, p.lastAcceptedAt ?? -1) : p.lastAcceptedAt;
  if (!later && lastAcceptedAt === p.lastAcceptedAt) return false;
  records.set(p.key, {
    ...p, updatedAt: Date.now(), lastAcceptedAt,
    ...(later ? {status: result.status, officialStatus: result.officialStatus, lastSubmittedAt: result.at} : {}),
  });
  return true;
}

async function regularFile(file: string): Promise<boolean> {
  try { return (await lstat(file)).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return false;
    throw error;
  }
}

function newRecord(item: Entry): LocalProblem {
  const now = Date.now();
  const {inferredSource, ...identity} = item;
  return {...identity, sourceConfirmed: !inferredSource, importedAt: item.importedAt ?? now, updatedAt: now, status: 'not_submitted', tags: []};
}

async function usableSource(source: string): Promise<boolean> {
  try { await rejectSymlinks(source); return await regularFile(source); }
  catch { return false; }
}

function replayResults(records: Map<string, LocalProblem>, history: readonly ResultEvent[], only?: Set<string>): boolean {
  let changed = false;
  for (const job of history) {
    const result = resultUpdate(job);
    if (result && applyResult(records, result, only)) changed = true;
  }
  return changed;
}

export class LocalProblemIndex {
  private pending = Promise.resolve();
  private snapshot = '[]';
  private records = new Map<string, LocalProblem>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: LocalProblemStorage) {}

  private publish(records: Map<string, LocalProblem>): void {
    const snapshot = JSON.stringify([...records.values()]);
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    this.records = records;
    for (const listener of this.listeners) listener();
  }

  list(): LocalProblem[] { return [...this.records.values()]; }
  get(key: string): LocalProblem | undefined { return this.records.get(key); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private schedule<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(action);
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  reload(): Promise<void> {
    return this.schedule(async () => this.publish(readRecords(await this.storage.read())));
  }

  private mutate<T>(change: (records: Map<string, LocalProblem>) => Promise<[T, boolean]> | [T, boolean]): Promise<T> {
    return this.schedule(async () => {
      const {value, records} = await this.storage.withLock(async () => {
        const records = readRecords(await this.storage.read());
        const [value, changed] = await change(records);
        if (changed) await this.storage.write([...records.values()]);
        return {value, records};
      });
      this.publish(records);
      return value;
    });
  }

  upsert(problem: Problem, localFilePath: string, history: readonly ResultEvent[] = [], statement?: string): Promise<LocalProblem> {
    const item = entry(problem, localFilePath, undefined, statement);
    return this.mutate(async records => {
      const previousCourse = item.inferredSource && records.get(`lanqiao-course:${item.id}`);
      const old = records.get(item.key) || (previousCourse && path.dirname(previousCourse.localFilePath) === path.dirname(item.localFilePath) ? previousCourse : undefined);
      if (!old) {
        records.set(item.key, newRecord(item));
        replayResults(records, history, new Set([item.key]));
      } else {
        let source = old.localFilePath;
        if (source !== item.localFilePath) {
          // A repeat import should keep a still usable local path, even if the root has changed.
          if (!await usableSource(source)) source = item.localFilePath;
        }
        let markdownFilePath = old.markdownFilePath;
        if (path.dirname(source) === path.dirname(item.localFilePath) && item.markdownFilePath &&
            (!markdownFilePath || (source !== old.localFilePath && !await usableSource(markdownFilePath)))) {
          markdownFilePath = item.markdownFilePath;
        }
        records.set(old.key, {...old, title: item.title, localFilePath: source,
          markdownFilePath,
          sourceConfirmed: old.sourceConfirmed || !item.inferredSource,
          sourceUrl: item.inferredSource ? old.sourceUrl : item.sourceUrl, updatedAt: Date.now()});
      }
      return [records.get(old?.key ?? item.key)!, true];
    });
  }

  setTags(key: string, tags: string[]): Promise<void> {
    const normalized = normalizeTags(tags);
    return this.mutate(records => {
      const old = records.get(key);
      if (!old) throw new Error('题目记录不存在');
      records.set(key, {...old, tags: normalized, updatedAt: Date.now()});
      return [undefined, true];
    });
  }

  setMarkdownPath(key: string, value: string): Promise<void> {
    const file = markdownPath(value);
    if (!file) return Promise.reject(new Error('请选择本地 Markdown 文件'));
    return this.mutate(records => {
      const old = records.get(key);
      if (!old) throw new Error('题目记录不存在');
      if (old.markdownFilePath === file) return [undefined, false];
      records.set(key, {...old, markdownFilePath: file, updatedAt: Date.now()});
      return [undefined, true];
    });
  }

  setSourcePath(key: string, file: string): Promise<void> {
    if (!path.isAbsolute(file) || !languageOfSource(file)) return Promise.reject(new Error('请选择本地 C / C++ 文件'));
    const localFilePath = path.normalize(file);
    return this.mutate(records => {
      const old = records.get(key);
      if (!old) throw new Error('题目记录不存在');
      if (old.localFilePath === localFilePath) return [undefined, false];
      records.set(key, {...old, localFilePath, updatedAt: Date.now()});
      return [undefined, true];
    });
  }

  recordResult(job: ResultEvent): Promise<void> {
    const result = resultUpdate(job);
    if (!result) return Promise.resolve();
    return this.mutate(records => [undefined, applyResult(records, result)]);
  }

  reconcile(history: readonly ResultEvent[]): Promise<void> {
    return this.mutate(records => [undefined, replayResults(records, history)]);
  }

  async importExisting(root: string, preferred: (id: string) => LanguageId, history: readonly ResultEvent[]): Promise<MigrationResult> {
    await rejectSymlinks(root);
    const directories = await readdir(root, {withFileTypes: true}).catch(error => {
      if (error.code === 'ENOENT') throw new Error('题目根目录不存在，请检查 Lanqiao Root 设置');
      throw error;
    });
    const discovered: Entry[] = [];
    let skipped = 0;
    for (const directory of directories) {
      if (!directory.isDirectory() || !/^\d{1,10}-/.test(directory.name)) continue;
      try {
        const base = path.join(root, directory.name);
        const metadata = path.join(base, '.lanqiao.json');
        await rejectSymlinks(metadata);
        const info = await lstat(metadata);
        if (!info.isFile() || info.size > 5_000_000) throw new Error('题目元数据不可用');
        const problem = validateProblem(JSON.parse(await readFile(metadata, 'utf8')));
        if (!directory.name.startsWith(`${problem.id}-`)) throw new Error('题号与目录不符');
        const language = preferred(problem.id);
        const source = await findProblemSource(base, problem.id, language)
          ?? await findProblemSource(base, problem.id, language === 'cpp' ? 'c' : 'cpp');
        if (!source) throw new Error('源码不存在');
        const statement = path.join(base, 'README.md');
        discovered.push(entry(problem, source, info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs,
          await regularFile(statement) ? statement : undefined));
      } catch { skipped++; }
    }
    return this.mutate(async records => {
      const added = new Set<string>();
      let changed = false;
      const indexedPaths = new Set([...records.values()].map(p => path.dirname(p.localFilePath)));
      for (const item of discovered) {
        const old = records.get(item.key);
        if (!old) {
          if (item.inferredSource && indexedPaths.has(path.dirname(item.localFilePath))) continue;
          records.set(item.key, newRecord(item));
          indexedPaths.add(path.dirname(item.localFilePath));
          added.add(item.key);
          changed = true;
        } else if (old.localFilePath !== item.localFilePath && !await usableSource(old.localFilePath)) {
          const markdownFilePath = old.markdownFilePath && await usableSource(old.markdownFilePath)
            ? old.markdownFilePath : item.markdownFilePath;
          records.set(item.key, {...old, localFilePath: item.localFilePath, markdownFilePath, updatedAt: Date.now()});
          changed = true;
        }
      }
      changed = replayResults(records, history) || changed;
      return [{found: discovered.length, added: added.size, skipped}, changed];
    });
  }
}
