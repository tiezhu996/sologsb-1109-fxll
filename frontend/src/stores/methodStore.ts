import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toMethodSnapshot, type Auxiliary, type CriterionDimension, type FireLevel, type MethodName, type ProcessingMethod } from '../types/processing-method';

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
}

/** 修订结果：inplace=未被工序引用，原地更新；fork=已被引用，生成了新版本 */
export type UpdateOutcome =
  | { mode: 'inplace'; method: ProcessingMethod }
  | { mode: 'fork'; method: ProcessingMethod; previous: ProcessingMethod }
  | undefined;

interface MethodState {
  /** 全部方法版本（含 active 与 superseded） */
  methods: ProcessingMethod[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addMethod: (input: MethodInput) => Promise<ProcessingMethod>;
  /**
   * 保存对方法的修改：
   * - 该方法族尚未被任何工序引用：原地更新当前版本；
   * - 已被工序引用：旧版本置为 superseded 并保留，另生成 active 新版本，仅供后续批次选择；
   * - 历史版本（superseded）一律不再修改。
   */
  updateMethod: (id: string, patch: Partial<MethodInput>, changeNote?: string) => Promise<UpdateOutcome>;
  /** 删除方法族（仅允许删除从未被工序引用的方法族） */
  removeSeries: (seriesId: string) => Promise<void>;
  /** 复制派生：以某个具体方法版本为模板生成一个全新方法族（可改辅料比例） */
  deriveMethod: (sourceId: string, name: MethodName, auxRatio?: number) => Promise<ProcessingMethod | undefined>;
  /** 某方法族是否已被工序引用（被引用后修改必须生成新版本） */
  isSeriesUsed: (seriesId: string) => Promise<boolean>;
  /** 选择方法即带出辅料比例、火候与判断标准（按具体版本 id 查询） */
  describe: (id: string) => { auxiliary: Auxiliary; auxRatio: number; fireLevel: FireLevel; tempRange: [number, number]; duration: number; criterion: string } | undefined;
}

export const useMethodStore = create<MethodState>()((set, get) => ({
  methods: [],
  hydrated: false,

  hydrate: async () => {
    const methods = await db.methods.toArray();
    methods.sort((a, b) => {
      const sa = a.seriesId ?? a.id;
      const sb = b.seriesId ?? b.id;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (a.version ?? 1) - (b.version ?? 1);
    });
    set({ methods, hydrated: true });
  },

  addMethod: async (input) => {
    const id = uid('method');
    const method: ProcessingMethod = {
      id,
      seriesId: id,
      version: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
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

  updateMethod: async (id, patch, changeNote) => {
    const current = get().methods.find((m) => m.id === id);
    if (!current) {
      return undefined;
    }
    // 历史版本只读，避免改动已被批次冻结的标准
    if (current.status === 'superseded') {
      return undefined;
    }

    const seriesId = current.seriesId;
    const usedCount = await db.batches.where('methodSeriesId').equals(seriesId).count();
    const nowIso = new Date().toISOString();

    // 未被任何工序引用：原地更新，不产生新版本
    if (usedCount === 0) {
      const next: ProcessingMethod = {
        ...current,
        ...patch,
        auxRatio: patch.auxRatio !== undefined ? Number(patch.auxRatio) || 0 : current.auxRatio,
        duration: patch.duration !== undefined ? Number(patch.duration) || 0 : current.duration,
        criterion: patch.criterion !== undefined ? patch.criterion.trim() : current.criterion,
        applicable: patch.applicable !== undefined ? patch.applicable.trim() : current.applicable,
      };
      await db.methods.put(next);
      set({ methods: get().methods.map((m) => (m.id === id ? next : m)) });
      return { mode: 'inplace', method: next };
    }

    // 已有工序引用：旧版本停用保留，生成新版本
    const previous: ProcessingMethod = { ...current, status: 'superseded', supersededAt: nowIso };
    const newId = uid('method');
    const created: ProcessingMethod = {
      ...current,
      ...patch,
      id: newId,
      seriesId,
      version: current.version + 1,
      status: 'active',
      changeNote: changeNote?.trim() || undefined,
      createdAt: nowIso,
      supersededAt: undefined,
      initial: false,
      auxRatio: patch.auxRatio !== undefined ? Number(patch.auxRatio) || 0 : current.auxRatio,
      duration: patch.duration !== undefined ? Number(patch.duration) || 0 : current.duration,
      criterion: patch.criterion !== undefined ? patch.criterion.trim() : current.criterion,
      applicable: patch.applicable !== undefined ? patch.applicable.trim() : current.applicable,
    };
    await db.transaction('rw', db.methods, async () => {
      await db.methods.put(previous);
      await db.methods.put(created);
    });
    set({ methods: [...get().methods.filter((m) => m.id !== previous.id), previous, created] });
    return { mode: 'fork', method: created, previous };
  },

  removeSeries: async (seriesId) => {
    const used = await db.batches.where('methodSeriesId').equals(seriesId).count();
    if (used > 0) {
      throw new Error('该方法已有工序引用，不能删除（可继续修订生成新版本，历史版本会保留备查）');
    }
    const ids = get()
      .methods.filter((m) => m.seriesId === seriesId)
      .map((m) => m.id);
    await db.methods.bulkDelete(ids);
    set({ methods: get().methods.filter((m) => m.seriesId !== seriesId) });
  },

  deriveMethod: async (sourceId, name, auxRatio) => {
    const source = get().methods.find((m) => m.id === sourceId);
    if (!source) {
      return undefined;
    }
    // 派生 = 以源版本为模板另立方法族，固化当时的判定依据与派生关系
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
    });
  },

  isSeriesUsed: async (seriesId) => (await db.batches.where('methodSeriesId').equals(seriesId).count()) > 0,

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
}));

/** 各方法族当前生效（最新）版本，按首次出现顺序稳定排序；新建批次只能选择这些版本 */
export function selectLatestMethods(methods: ProcessingMethod[]): ProcessingMethod[] {
  const latest = new Map<string, ProcessingMethod>();
  methods.forEach((m) => {
    const seriesId = m.seriesId ?? m.id;
    const held = latest.get(seriesId);
    if (!held || (m.version ?? 1) > (held.version ?? 1)) {
      latest.set(seriesId, m);
    }
  });
  const order = new Map<string, number>();
  methods.forEach((m, index) => {
    const seriesId = m.seriesId ?? m.id;
    if (!order.has(seriesId)) order.set(seriesId, index);
  });
  return Array.from(latest.values()).sort((a, b) => (order.get(a.seriesId) ?? 0) - (order.get(b.seriesId) ?? 0));
}

/** 同一方法族的全部版本，版本号升序 */
export function selectSeriesVersions(methods: ProcessingMethod[], seriesId: string): ProcessingMethod[] {
  return methods
    .filter((m) => (m.seriesId ?? m.id) === seriesId)
    .sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
}

/** 由方法版本生成批次快照（供批次保存时冻结） */
export function snapshotOf(method: ProcessingMethod) {
  return toMethodSnapshot(method);
}
