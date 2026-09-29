import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { methodSnapshotById } from './methodStore';
import { placeholderSnapshot } from '../utils/version';
import type { FireLevel, ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree } from '../types/process-batch';

export interface BatchInput {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  startedAt: string;
  endedAt: string;
  yieldRate: number;
  degree: ProcessDegree;
  operator: string;
  remark?: string;
  /** 方法变更时随表单传入的新快照；不传则保留批次原有快照（质检改判不覆盖） */
  methodSnapshot?: ProcessingMethod;
}

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createBatch: (input: BatchInput, lock?: boolean) => Promise<ProcessBatch>;
  updateBatch: (id: string, patch: Partial<BatchInput>, force?: boolean) => Promise<boolean>;
  removeBatch: (id: string) => Promise<void>;
  /** 提交得率与程度判定后锁定该批 */
  lockBatch: (id: string) => Promise<void>;
  /** 质检员放行/改判：仅质检员可解锁 */
  unlockAsQc: (id: string, qcBy: string) => Promise<void>;
  degreeCount: () => Record<ProcessDegree, number>;
  pendingBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const batches = await db.batches.orderBy('startedAt').reverse().toArray();
    set({ batches, hydrated: true });
  },

  createBatch: async (input, lock = false) => {
    // 建批即冻结当时方法版本快照：方法后续调整只生成新版本，不影响本批判定依据
    const snapshot = (await methodSnapshotById(input.methodId)) ?? placeholderSnapshot(input.methodId, input.fireLevel);
    const batch: ProcessBatch = {
      id: uid('batch'),
      batchNo: input.batchNo.trim(),
      herbId: input.herbId,
      methodId: input.methodId,
      methodSnapshot: snapshot,
      feedKg: Number(input.feedKg) || 0,
      auxUsedKg: Number(input.auxUsedKg) || 0,
      fireLevel: input.fireLevel,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      yieldRate: Number(input.yieldRate) || 0,
      degree: input.degree,
      operator: input.operator.trim(),
      locked: lock,
      lockedAt: lock ? new Date().toISOString() : undefined,
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  updateBatch: async (id, patch, force = false) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    if (current.locked && !force) {
      return false;
    }
    // 快照只随方法变更而更新；质检改判（force）不得覆盖历史判定依据
    const nextMethodId = patch.methodId;
    const methodChanged = nextMethodId !== undefined && nextMethodId !== current.methodId;
    const methodSnapshot = methodChanged
      ? patch.methodSnapshot ?? (nextMethodId ? await methodSnapshotById(nextMethodId) : undefined) ?? current.methodSnapshot
      : current.methodSnapshot;
    const next: ProcessBatch = {
      ...current,
      ...patch,
      methodSnapshot,
    };
    if (force) {
      next.qcBy = next.qcBy ?? '质检员 · 赵敏';
    }
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  removeBatch: async (id) => {
    await db.batches.delete(id);
    set({ batches: get().batches.filter((b) => b.id !== id) });
  },

  lockBatch: async (id) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: true, lockedAt: new Date().toISOString() };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
  },

  unlockAsQc: async (id, qcBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: false, qcBy };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
  },

  degreeCount: () => {
    const result: Record<ProcessDegree, number> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      result[b.degree] += 1;
    });
    return result;
  },

  pendingBatches: () => get().batches.filter((b) => !b.locked),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
