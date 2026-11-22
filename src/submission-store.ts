import {createHash, randomUUID} from 'node:crypto';
import {constants, unwatchFile, watchFile} from 'node:fs';
import {link, lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {requireLanguage, type LanguageId} from './languages';
import type {PlatformResult} from './report';
import {rejectSymlinks} from './storage';

const VERDICTS = {
  AC: 'accepted', WA: 'wrong_answer', TLE: 'time_limit_exceeded',
  MLE: 'memory_limit_exceeded', RE: 'runtime_error', CE: 'compile_error',
} as const;
export type SubmissionStatus = (typeof VERDICTS)[keyof typeof VERDICTS] | 'pending' | 'other' | 'unknown' | 'not_sent';
export type ReviewStatus = 'needs_review' | 'reviewing' | 'reviewed';

export interface SubmissionSnapshot {
  id: string;
  problemKey: string;
  createdAt: number;
  language: LanguageId;
  sourcePath: string;
  status: SubmissionStatus;
  submissionId?: string;
  officialStatus?: string;
  durationMs?: number;
  memoryKb?: number;
  codeHash: string;
}

export interface ReviewEntry {
  problemKey: string;
  status: ReviewStatus;
  reviewedAt?: number;
  lastFailure?: {at: number; status: SubmissionStatus; id: string};
}

interface StoredSnapshot extends SubmissionSnapshot {keep: number; sent?: true}
interface StoreData {version: 1; snapshots: StoredSnapshot[]; reviews: ReviewEntry[]}
interface SnapshotJob {id: string; created: number; kind: string; language?: LanguageId; sourceName?: string; code?: string}
interface ResultJob {id: string; state: string; worker?: string; result?: PlatformResult}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROBLEM_KEY = /^lanqiao-(oj|course):\d{1,10}$/;
const RECEIPT = /^[\w-]{1,160}$/;
const HASH = /^[\da-f]{64}$/;
const OFFICIAL_STATUS = /^[^\u0000-\u001f\u007f]{1,80}$/;
const FAILURE_STATUSES = new Set<SubmissionStatus>(['wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error']);
const FINAL_STATUSES = new Set<SubmissionStatus>(['accepted', 'other', ...FAILURE_STATUSES]);
const REVIEW_STATUSES = new Set<ReviewStatus>(['needs_review', 'reviewing', 'reviewed']);
const PENDING_MS = 180_000; // The default lifetime of a submission job in BridgeServer.
const DEFAULT_RETENTION = 20;
const MAX_CODE_LENGTH = 500_000;
const MAX_CODE_BYTES = MAX_CODE_LENGTH * 3;

const errno = (error: unknown) => (error as NodeJS.ErrnoException).code;
const codeHash = (code: Buffer) => createHash('sha256').update(code).digest('hex');
const validText = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && value.match(pattern)?.[0] === value;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value) && value <= 8.64e15;
const absoluteSource = (value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
const retention = (keep: number) => Number.isFinite(keep) ? Math.min(200, Math.max(1, Math.floor(keep))) : DEFAULT_RETENTION;
const isPending = (item: SubmissionSnapshot, now = Date.now()) => item.status === 'pending' && item.createdAt + PENDING_MS > now;
const newestFirst = (a: SubmissionSnapshot, b: SubmissionSnapshot) => b.createdAt - a.createdAt;
const optional = (value: unknown, valid: (data: unknown) => boolean) => value === undefined || valid(value);

function checkProblemKey(key: string): void {
  if (!validText(key, PROBLEM_KEY)) throw new Error('快照对应的题目标识无效');
}

function checkId(id: string): void {
  if (!validText(id, UUID)) throw new Error('提交快照标识无效');
}

function decode(raw: Buffer): StoreData {
  const invalid = () => new Error('提交快照索引损坏，请检查扩展的本地存储文件');
  let data: Partial<StoreData>;
  try { data = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  if (data?.version !== 1 || !Array.isArray(data.snapshots) || !Array.isArray(data.reviews)) throw invalid();
  const ids = new Set<string>();
  for (const item of data.snapshots) {
    if (!item || !validText(item.id, UUID) || ids.has(item.id) || !validText(item.problemKey, PROBLEM_KEY) ||
      !timestamp(item.createdAt) || !absoluteSource(item.sourcePath) || !validText(item.codeHash, HASH) ||
      (item.language !== 'cpp' && item.language !== 'c') || item.keep !== retention(item.keep) ||
      !optional(item.sent, value => value === true) || !optional(item.submissionId, value => validText(value, RECEIPT)) ||
      !optional(item.durationMs, nonnegative) || !optional(item.memoryKb, nonnegative)) throw invalid();
    if (FINAL_STATUSES.has(item.status)) {
      if (!item.submissionId || !validText(item.officialStatus, OFFICIAL_STATUS)) throw invalid();
    } else if (!['pending', 'unknown', 'not_sent'].includes(item.status) || item.officialStatus !== undefined) throw invalid();
    ids.add(item.id);
  }
  const keys = new Set<string>();
  for (const review of data.reviews) {
    if (!review || !validText(review.problemKey, PROBLEM_KEY) || keys.has(review.problemKey) ||
      !REVIEW_STATUSES.has(review.status) || !optional(review.reviewedAt, timestamp)) throw invalid();
    if (review.lastFailure !== undefined) {
      const fail = review.lastFailure;
      if (!fail || !validText(fail.id, UUID) || !timestamp(fail.at) || !FAILURE_STATUSES.has(fail.status)) throw invalid();
    }
    keys.add(review.problemKey);
  }
  return {version: 1, snapshots: data.snapshots, reviews: data.reviews};
}

async function readRegular(file: string, maxBytes?: number): Promise<Buffer> {
  await rejectSymlinks(file);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || (maxBytes !== undefined && info.size > maxBytes)) throw new Error(`本地存储文件无效：${file}`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function atomicWrite(file: string, data: string | Buffer, createOnly = false): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(data); await handle.sync(); }
    finally { await handle.close(); }
    if (createOnly) await link(temporary, file);
    else await rename(temporary, file);
  } finally { await unlink(temporary).catch(error => {if (errno(error) !== 'ENOENT') throw error;}); }
}

function optionalMetric(value: unknown): number | undefined {
  const numeric = validText(value, /^\d+(?:\.\d+)?$/) ? Number(value) : value;
  return nonnegative(numeric) ? numeric : undefined;
}

function finalStatus(result: PlatformResult) {
  const officialStatus = typeof result.status === 'string' ? result.status.trim() : '';
  if (!validText(officialStatus, OFFICIAL_STATUS) || !validText(result.submissionId, RECEIPT)) return;
  const code = officialStatus.toUpperCase();
  const durationMs = optionalMetric(result.runtime), memoryKb = optionalMetric(result.memory);
  return {
    status: Object.hasOwn(VERDICTS, code) ? VERDICTS[code as keyof typeof VERDICTS] : 'other' as const,
    officialStatus, ...(durationMs !== undefined ? {durationMs} : {}), ...(memoryKb !== undefined ? {memoryKb} : {}),
  };
}

function updateSnapshot(previous: StoredSnapshot, job: ResultJob, actualProblemKey?: string): StoredSnapshot {
  if (FINAL_STATUSES.has(previous.status)) return previous;
  const problemKey = actualProblemKey?.split(':')[1] === previous.problemKey.split(':')[1] ? actualProblemKey : previous.problemKey;
  const result = job.result;
  const submissionId = validText(result?.submissionId, RECEIPT) ? result.submissionId : previous.submissionId;
  const terminal = job.state === 'finished' || job.state === 'expired';
  if (previous.submissionId && submissionId !== previous.submissionId) {
    return terminal && previous.status === 'pending' ? {...previous, status: 'unknown'} : previous;
  }
  const sent = Boolean(previous.sent || submissionId || (result && ['sent', 'accepted', 'judging', 'done'].includes(result.phase)));
  const current = {...previous, problemKey, ...(submissionId ? {submissionId} : {}), ...(sent ? {sent: true as const} : {})};
  const official = job.state === 'finished' && result?.phase === 'done' ? finalStatus(result) : undefined;
  if (official) return {...current, ...official};
  if (previous.status !== 'pending') return previous;
  if (!terminal) return current;
  // A claimed job can have reached the platform even if its local progress message was lost.
  return {...current, status: !job.worker && !sent && (result?.phase === 'error' || result?.phase === 'prepared') ? 'not_sent' : 'unknown'};
}

function prune(data: StoreData, problemKey: string, keep: number): StoredSnapshot[] {
  const removed = data.snapshots.filter(item => item.problemKey === problemKey).reverse().sort(newestFirst)
    .slice(keep).filter(item => !isPending(item));
  if (removed.length) {
    const ids = new Set(removed.map(item => item.id));
    data.snapshots = data.snapshots.filter(item => !ids.has(item.id));
  }
  return removed;
}

/** Snapshot lists order equal timestamps by storage insertion, newest first. */
export function selectReviewComparison(snapshots: readonly SubmissionSnapshot[]):
  {failed: SubmissionSnapshot; accepted?: SubmissionSnapshot} | undefined {
  const chronological = snapshots.filter(snapshot => timestamp(snapshot.createdAt) && validText(snapshot.submissionId, RECEIPT))
    .reverse().sort((a, b) => a.createdAt - b.createdAt);
  let latestFailure: SubmissionSnapshot | undefined;
  let failureBeforeAcceptance: SubmissionSnapshot | undefined;
  let pair: {failed: SubmissionSnapshot; accepted: SubmissionSnapshot} | undefined;
  for (const snapshot of chronological) {
    if (FAILURE_STATUSES.has(snapshot.status)) {
      latestFailure = failureBeforeAcceptance = snapshot;
    } else if (snapshot.status === 'accepted' && failureBeforeAcceptance) {
      pair = {failed: failureBeforeAcceptance, accepted: snapshot};
      failureBeforeAcceptance = undefined;
    }
  }
  return pair ?? (latestFailure && {failed: latestFailure});
}

const NOTE = '## 错因\n\n## 知识点\n\n## 思路\n\n## 总结\n';
const copyReview = (review: ReviewEntry): ReviewEntry => ({
  ...review, ...(review.lastFailure ? {lastFailure: {...review.lastFailure}} : {}),
});

export class SubmissionStore {
  private readonly directory: string;
  private readonly index: string;
  private readonly lock: string;
  private data: StoreData = {version: 1, snapshots: [], reviews: []};
  private snapshotsById = new Map<string, StoredSnapshot>();
  private snapshotsByProblem = new Map<string, StoredSnapshot[]>();
  private serialized = JSON.stringify(this.data);
  private pending = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.index = path.join(this.directory, 'submissions.json');
    this.lock = this.index + '.lock';
  }

  private codeFile(id: string): string { return path.join(this.directory, 'code', `${id}.source`); }

  private async ensureDirectory(directory: string): Promise<void> {
    await rejectSymlinks(directory);
    await mkdir(directory, {recursive: true, mode: 0o700});
  }

  private transact<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action);
    this.pending = next.then(() => {}, () => {});
    return next;
  }

  private async read(): Promise<StoreData> {
    try { return decode(await readRegular(this.index)); }
    catch (error) {
      if (errno(error) === 'ENOENT') return {version: 1, snapshots: [], reviews: []};
      throw error;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(); }
      catch (error) { process.emitWarning(`刷新提交快照视图失败：${String(error)}`); }
    }
  }

  private publish(data: StoreData, json = JSON.stringify(data)): void {
    if (this.serialized === json) return;
    this.data = data;
    this.serialized = json;
    this.snapshotsById = new Map(data.snapshots.map(item => [item.id, item]));
    this.snapshotsByProblem = new Map();
    for (const item of data.snapshots) {
      const group = this.snapshotsByProblem.get(item.problemKey);
      if (group) group.push(item);
      else this.snapshotsByProblem.set(item.problemKey, [item]);
    }
    // Equal timestamps retain submission insertion order instead of sorting by random IDs.
    for (const group of this.snapshotsByProblem.values()) group.reverse().sort(newestFirst);
    this.notify();
  }

  private async clearExitedOwner(): Promise<boolean> {
    const readOwner = async () => (await readRegular(this.lock, 200)).toString('utf8');
    let owner: string;
    try { owner = await readOwner(); }
    catch (error) {
      if (errno(error) === 'ENOENT') return true;
      throw error;
    }
    const [pidText, nonce] = owner.split(':');
    if (!/^\d{1,10}$/.test(pidText) || !nonce || !UUID.test(nonce)) return false;
    const pid = Number(pidText);
    if (pid <= 0 || pid > 0x7fffffff) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { if (errno(error) !== 'ESRCH') return false; }

    // Only one window may reclaim this dead owner's lock generation.
    const recovery = `${this.lock}.${nonce}.recovery`;
    const guard = await open(recovery, 'wx', 0o600).catch(error => {
      if (errno(error) === 'EEXIST') return undefined;
      throw error;
    });
    if (!guard) return false;
    try {
      await guard.close();
      const current = await readOwner().catch(error => {
        if (errno(error) === 'ENOENT') return undefined;
        throw error;
      });
      if (current !== owner) return true;
      await unlink(this.lock);
      return true;
    } finally { await unlink(recovery); }
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await this.ensureDirectory(this.directory);
    const deadline = Date.now() + 3_000;
    const owner = `${process.pid}:${randomUUID()}`;
    for (;;) {
      try {
        await atomicWrite(this.lock, owner, true);
        break;
      } catch (error) {
        if (errno(error) !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error(`提交快照索引被占用，请重试。若完全退出所有 VSCode 窗口后仍无法恢复，可删除锁文件 ${this.lock}`);
        if (!await this.clearExitedOwner()) await delay(40);
      }
    }
    try { return await action(); }
    finally { await unlink(this.lock); }
  }

  private mutate<T>(change: (data: StoreData, removed: StoredSnapshot[]) => T | Promise<T>, manualCleanup = false): Promise<T> {
    return this.transact(async () => {
      const {data, json, errors, result} = await this.withLock(async () => {
        const data = await this.read();
        const before = JSON.stringify(data);
        const removed: StoredSnapshot[] = [];
        const result = await change(data, removed);
        const json = JSON.stringify(data);
        if (json !== before) await atomicWrite(this.index, json);
        // Delete code under the same lock, after its index entry has been removed.
        const errors: unknown[] = [];
        for (const item of removed) {
          const file = this.codeFile(item.id);
          try {
            if (codeHash(await readRegular(file, MAX_CODE_BYTES)) === item.codeHash) await unlink(file);
          } catch (error) {
            if (errno(error) !== 'ENOENT') errors.push(error);
          }
        }
        return {data, json, errors, result};
      });
      this.publish(data, json);
      if (errors.length) {
        const message = `提交记录已移除，但有 ${errors.length} 个快照源码文件无法清理，请检查本地存储`;
        if (manualCleanup) throw new Error(message, {cause: errors[0]});
        process.emitWarning(`${message}：${String(errors[0])}`);
      }
      return result;
    });
  }

  reload(): Promise<void> { return this.transact(async () => this.publish(await this.read())); }

  async watchChanges(onError: (error: unknown) => void): Promise<{dispose(): void}> {
    await this.ensureDirectory(this.directory);
    const refresh = () => { void this.reload().catch(onError); };
    // Watch the path across atomic replacements, including creation of the first index.
    watchFile(this.index, {persistent: false, interval: 500}, refresh);
    let expiration: NodeJS.Timeout | undefined;
    const watchExpiry = () => {
      clearTimeout(expiration);
      const now = Date.now();
      const first = this.data.snapshots.reduce((next, item) => isPending(item, now) ? Math.min(next, item.createdAt + PENDING_MS) : next, Infinity);
      if (Number.isFinite(first)) expiration = setTimeout(() => this.notify(), Math.min(first - now, 2_147_483_647)).unref();
    };
    const unsubscribe = this.onChange(watchExpiry);
    watchExpiry();
    return {dispose: () => {unwatchFile(this.index, refresh); unsubscribe(); clearTimeout(expiration);}};
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  private snapshot({keep: _keep, sent: _sent, ...item}: StoredSnapshot): SubmissionSnapshot {
    return item.status === 'pending' && !isPending(item) ? {...item, status: 'unknown'} : item;
  }

  list(problemKey: string): SubmissionSnapshot[] {
    return this.snapshotsByProblem.get(problemKey)?.map(item => this.snapshot(item)) ?? [];
  }

  get(id: string): SubmissionSnapshot | undefined {
    const item = this.snapshotsById.get(id);
    return item && this.snapshot(item);
  }

  async readCode(id: string): Promise<string> {
    checkId(id);
    const item = this.get(id);
    if (!item) throw new Error('提交快照不存在，可能已按保留数量清理。请刷新提交记录');
    const code = await readRegular(this.codeFile(id), MAX_CODE_BYTES).catch(error => {
      if (errno(error) === 'ENOENT') throw new Error('提交快照源码已丢失，可移除此快照记录');
      throw new Error('无法读取提交快照源码，请检查本地存储文件', {cause: error});
    });
    if (codeHash(code) !== item.codeHash) throw new Error('提交快照源码完整性校验失败，可移除此快照记录');
    return code.toString('utf8');
  }

  async create(job: SnapshotJob, problemKey: string, sourcePath: string, keep = DEFAULT_RETENTION): Promise<void> {
    if (job.kind !== 'submit') return;
    checkId(job.id);
    checkProblemKey(problemKey);
    const {id, created, language, code} = job;
    await this.mutate(async (data, removed) => {
      if (data.snapshots.some(item => item.id === id)) return;
      if (!timestamp(created) || !absoluteSource(sourcePath) || typeof code !== 'string' || !code.length || code.length > MAX_CODE_LENGTH) {
        throw new Error('提交快照的源码、路径或时间无效');
      }
      const bytes = Buffer.from(code);
      if (bytes.toString('utf8') !== code) throw new Error('提交快照的源码编码无效');
      const item: StoredSnapshot = {id, createdAt: created, language: requireLanguage(language), problemKey, sourcePath,
        status: 'pending', codeHash: codeHash(bytes), keep: retention(keep)};
      const file = this.codeFile(id);
      await this.ensureDirectory(path.dirname(file));
      try { await atomicWrite(file, bytes, true); }
      catch (error) {
        // A previous attempt may have written the code before its index commit.
        if (errno(error) !== 'EEXIST') throw error;
        if (!(await readRegular(file, MAX_CODE_BYTES)).equals(bytes)) throw new Error('已存在的提交快照源码与本次提交不一致');
      }
      data.snapshots.push(item);
      removed.push(...prune(data, problemKey, item.keep));
    });
  }

  async record(job: ResultJob, actualProblemKey?: string): Promise<void> {
    checkId(job.id);
    if (actualProblemKey !== undefined) checkProblemKey(actualProblemKey);
    await this.mutate((data, removed) => {
      const index = data.snapshots.findIndex(item => item.id === job.id);
      if (index < 0) return;
      const previous = data.snapshots[index];
      const current = updateSnapshot(previous, job, actualProblemKey);
      if (current === previous) return;
      data.snapshots[index] = current;
      if (FAILURE_STATUSES.has(current.status)) {
        const i = data.reviews.findIndex(item => item.problemKey === current.problemKey);
        const entry: ReviewEntry = i < 0 ? {problemKey: current.problemKey, status: 'needs_review'} : data.reviews[i];
        const failure = entry.lastFailure;
        if (!failure || current.createdAt > failure.at || (current.createdAt === failure.at &&
            data.snapshots.findIndex(item => item.id === failure.id) < index)) {
          const review = {...entry, lastFailure: {at: current.createdAt, status: current.status, id: current.id}};
          if (i < 0) data.reviews.push(review);
          else data.reviews[i] = review;
        }
      }
      if (current.status !== 'pending' || current.problemKey !== previous.problemKey) {
        const latest = data.snapshots.filter(item => item.problemKey === current.problemKey).reverse().sort(newestFirst)[0];
        removed.push(...prune(data, current.problemKey, latest.keep));
      }
    });
  }

  async remove(id: string): Promise<void> {
    checkId(id);
    await this.mutate((data, removed) => {
      const i = data.snapshots.findIndex(item => item.id === id);
      if (i < 0) return;
      if (isPending(data.snapshots[i])) throw new Error('提交仍在进行，请等待判定后再移除快照');
      removed.push(...data.snapshots.splice(i, 1));
    }, true);
  }

  async clean(problemKey: string, keep = DEFAULT_RETENTION): Promise<number> {
    checkProblemKey(problemKey);
    return this.mutate((data, removed) => removed.push(...prune(data, problemKey, retention(keep))), true);
  }

  listReviews(): ReviewEntry[] { return this.data.reviews.map(copyReview); }

  getReview(problemKey: string): ReviewEntry | undefined {
    const entry = this.data.reviews.find(review => review.problemKey === problemKey);
    return entry && copyReview(entry);
  }

  private updateReview(problemKey: string, status?: ReviewStatus): Promise<void> {
    checkProblemKey(problemKey);
    return this.mutate(data => {
      const i = data.reviews.findIndex(review => review.problemKey === problemKey);
      const previous = data.reviews[i];
      if (previous && (!status || status === previous.status)) return;
      const current: ReviewEntry = {...previous, problemKey, status: status ?? 'needs_review'};
      if (status === 'reviewed') current.reviewedAt = Date.now();
      if (i < 0) data.reviews.push(current);
      else data.reviews[i] = current;
    });
  }

  async setReview(problemKey: string, status: ReviewStatus): Promise<void> {
    if (!REVIEW_STATUSES.has(status)) throw new Error('复盘状态无效');
    await this.updateReview(problemKey, status);
  }

  async ensureReview(problemKey: string): Promise<void> { await this.updateReview(problemKey); }

  async noteFile(problemKey: string): Promise<string> {
    checkProblemKey(problemKey);
    const directory = path.join(this.directory, 'notes');
    const file = path.join(directory, problemKey.replace(':', '-') + '.md');
    await this.ensureDirectory(directory);
    try { await atomicWrite(file, NOTE, true); }
    catch (error) {
      if (errno(error) !== 'EEXIST') throw error;
      await rejectSymlinks(file);
      if (!(await lstat(file)).isFile()) throw new Error('复盘笔记路径不是普通文件');
    }
    return file;
  }
}
