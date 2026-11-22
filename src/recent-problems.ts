import type {Memento} from 'vscode';

interface RecentProblemEntry {
  problemKey: string;
  lastOpenedAt: number;
}

const storageKey = 'recentProblems.v1';
const keyPattern = /^lanqiao-(oj|course):\d{1,10}$/;
export const defaultRecentProblemLimit = 5;
export const maxRecentProblems = 100;

export class RecentProblems {
  private pending = Promise.resolve();

  constructor(private readonly state: Pick<Memento, 'get' | 'update'>) {}

  list(): RecentProblemEntry[] {
    const value = this.state.get<unknown>(storageKey);
    if (!Array.isArray(value)) return [];
    const entries = new Map<string, RecentProblemEntry>();
    for (const entry of value) {
      if (!entry || typeof entry.problemKey !== 'string' || !keyPattern.test(entry.problemKey) ||
          !Number.isSafeInteger(entry.lastOpenedAt) || entry.lastOpenedAt < 0 || entry.lastOpenedAt > 8.64e15) continue;
      const {problemKey, lastOpenedAt} = entry;
      if ((entries.get(problemKey)?.lastOpenedAt ?? -1) < lastOpenedAt) entries.set(problemKey, {problemKey, lastOpenedAt});
    }
    return [...entries.values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  private update(change: (entries: RecentProblemEntry[]) => RecentProblemEntry[]): Promise<void> {
    const request = this.pending.then(async () => {
      await this.state.update(storageKey, change(this.list()));
    });
    this.pending = request.catch(() => {});
    return request;
  }

  recordOpen(problemKey: string): Promise<void> {
    return this.update(entries => {
      const lastOpenedAt = Math.max(Date.now(), entries[0]?.lastOpenedAt ?? 0);
      const previous = entries.filter(entry => entry.problemKey !== problemKey);
      return [{problemKey, lastOpenedAt}, ...previous].slice(0, maxRecentProblems);
    });
  }

  remove(problemKey: string): Promise<void> {
    return this.update(entries => entries.filter(entry => entry.problemKey !== problemKey));
  }

  clear(): Promise<void> {
    return this.update(() => []);
  }
}
