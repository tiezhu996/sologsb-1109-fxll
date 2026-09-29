import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { snapshotOf } from '../utils/version';
import type { Auxiliary, CriterionDimension, FireLevel, MethodName, ProcessingMethod } from '../types/processing-method';

export interface MethodInput {
  name: MethodName;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempRange: [number, number];
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
  derivedFrom?: string;
  /** 版本说明（调整原因，如季节调整） */
  versionNote?: string;
}

export interface UpdateMethodResult {
  /** in-place：未被工序引用，原地更新；new-version：已有工序引用，生成了新版本 */
  created: 'in-place' | 'new-version';
  method: ProcessingMethod;
}

interface MethodState {
  methods: ProcessingMethod[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addMethod: (input: MethodInput) => Promise<ProcessingMethod>;
  updateMethod: (id: string, patch: Partial<MethodInput>) => Promise<UpdateMethodResult | undefined>;
  removeMethod: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  /** 复制派生：以某个方法版本为模板生成新方法 v1.0（可改辅料比例），派生关系指向具体版本 */
  deriveMethod: (sourceId: string, name: MethodName, auxRatio?: number) => Promise<ProcessingMethod | undefined>;
  /** 选择方法即带出辅料比例、火候与判断标准 */
  describe: (id: string) => { auxiliary: Auxiliary; auxRatio: number; fireLevel: FireLevel; tempRange: [number, number]; duration: number; criterion: string } | undefined;
  /** 按 id 取方法版本 */
  methodById: (id: string) => ProcessingMethod | undefined;
  /** 每个版本链的最新版本（供后续批次选择） */
  latestMethods: () => ProcessingMethod[];
  /** 同版本链的全部版本，按版本号升序 */
  versionsOf: (rootId: string) => ProcessingMethod[];
  /** 该方法版本被多少批次工序引用 */
  usageCount: (id: string) => Promise<number>;
}

export const useMethodStore = create<MethodState>()((set, get) => ({
  methods: [],
  hydrated: false,

  hydrate: async () => {
    const methods = await db.methods.toArray();
    set({ methods, hydrated: true });
  },

  addMethod: async (input) => {
    const id = uid('method');
    const method: ProcessingMethod = {
      id,
      rootId: id,
      versionNo: 1,
      versionLabel: 'v1.0',
      effectiveAt: new Date().toISOString(),
      versionNote: input.versionNote?.trim() || '初始版本',
      name: input.name,
      auxiliary: input.auxiliary,
      auxRatio: Number(input.auxRatio) || 0,
      fireLevel: input.fireLevel,
      tempRange: input.tempRange,
      duration: Number(input.duration) || 0,
      criterion: input.criterion.trim(),
      criterionDimension: input.criterionDimension,
      applicable: input.applicable.trim(),
      derivedFrom: input.derivedFrom,
    };
    await db.methods.put(method);
    set({ methods: [...get().methods, method] });
    return method;
  },

  updateMethod: async (id, patch) => {
    const current = get().methods.find((m) => m.id === id);
    if (!current) {
      return undefined;
    }
    const versionNote = patch.versionNote?.trim() || current.versionNote;
    const usedByBatches = await db.batches.where('methodId').equals(id).count();

    if (usedByBatches > 0) {
      // 已有工序引用：冻结旧版本，生成新版本，仅供后续批次选择；历史批次快照不受影响
      const nextVersionNo = current.versionNo + 1;
      const next: ProcessingMethod = {
        ...current,
        ...patch,
        id: uid('method'),
        rootId: current.rootId,
        versionNo: nextVersionNo,
        versionLabel: `v${nextVersionNo}.0`,
        prevVersionId: current.id,
        effectiveAt: new Date().toISOString(),
        versionNote,
      };
      await db.methods.put(next);
      set({ methods: [...get().methods, next] });
      return { created: 'new-version', method: next };
    }

    // 未被工序引用：原地更新
    const next: ProcessingMethod = { ...current, ...patch, versionNote };
    await db.methods.put(next);
    set({ methods: get().methods.map((m) => (m.id === id ? next : m)) });
    return { created: 'in-place', method: next };
  },

  removeMethod: async (id) => {
    const usedByBatches = await db.batches.where('methodId').equals(id).count();
    if (usedByBatches > 0) {
      return { ok: false, reason: `该版本已被 ${usedByBatches} 批工序引用，不能删除；如需调整请生成新版本。` };
    }
    await db.methods.delete(id);
    set({ methods: get().methods.filter((m) => m.id !== id) });
    return { ok: true };
  },

  deriveMethod: async (sourceId, name, auxRatio) => {
    const source = get().methods.find((m) => m.id === sourceId);
    if (!source) {
      return undefined;
    }
    return get().addMethod({
      name,
      auxiliary: source.auxiliary,
      auxRatio: auxRatio ?? source.auxRatio,
      fireLevel: source.fireLevel,
      tempRange: source.tempRange,
      duration: source.duration,
      criterion: source.criterion,
      criterionDimension: source.criterionDimension,
      applicable: `${source.applicable}（派生）`,
      derivedFrom: source.id,
      versionNote: `派生自 ${source.name} ${source.versionLabel}`,
    });
  },

  describe: (id) => {
    const method = get().methods.find((m) => m.id === id);
    if (!method) {
      return undefined;
    }
    return {
      auxiliary: method.auxiliary,
      auxRatio: method.auxRatio,
      fireLevel: method.fireLevel,
      tempRange: method.tempRange,
      duration: method.duration,
      criterion: method.criterion,
    };
  },

  methodById: (id) => get().methods.find((m) => m.id === id),

  latestMethods: () => {
    const map = new Map<string, ProcessingMethod>();
    for (const m of get().methods) {
      const prev = map.get(m.rootId);
      if (!prev || m.versionNo > prev.versionNo) {
        map.set(m.rootId, m);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  },

  versionsOf: (rootId) =>
    get()
      .methods.filter((m) => m.rootId === rootId)
      .sort((a, b) => a.versionNo - b.versionNo),

  usageCount: async (id) => db.batches.where('methodId').equals(id).count(),
}));

/** 供批次快照使用：按方法 id 取冻结快照 */
export async function methodSnapshotById(id: string): Promise<ProcessingMethod | undefined> {
  const method = await db.methods.get(id);
  return method ? snapshotOf(method) : undefined;
}
