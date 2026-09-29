import type {
  Auxiliary,
  CriterionDimension,
  FireLevel,
  MethodName,
  MethodSnapshot,
  ProcessingMethod,
} from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';

/** 批次回显/复核所需的方法视图（方法版本与冻结快照字段一致，页面不关心版本元数据） */
export interface MethodRefView {
  name: MethodName;
  version: number;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempRange: [number, number];
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
  initial?: boolean;
}

/** 批次展示/复核用的方法标准：冻结快照优先，快照缺失时回退到方法版本表 */
export type BatchMethodRef =
  | { kind: 'snapshot'; ref: MethodSnapshot }
  | { kind: 'version'; ref: ProcessingMethod }
  | undefined;

/** 统一转成页面展示视图 */
export function toMethodRefView(ref: MethodSnapshot | ProcessingMethod): MethodRefView {
  return {
    name: ref.name,
    version: ref.version,
    auxiliary: ref.auxiliary,
    auxRatio: ref.auxRatio,
    fireLevel: ref.fireLevel,
    tempRange: ref.tempRange,
    duration: ref.duration,
    criterion: ref.criterion,
    criterionDimension: ref.criterionDimension,
    applicable: ref.applicable,
    initial: ref.initial,
  };
}

/** 批次引用的方法是否已在方法表中被删除（仅可能发生在手动清库等异常路径） */
export function batchMethodMissing(batch: ProcessBatch, methods: ProcessingMethod[]): boolean {
  return !methods.some((m) => m.id === batch.methodId);
}

/**
 * 解析批次当时采用的方法：
 * 1. 一律以批次快照回显（旧工序重新打开不会按新标准显示）；
 * 2. 升级前尚未补快照的异常数据，回退按 id 查方法版本；
 * 3. 方法版本也找不到时返回 undefined（页面提示方法已删除）。
 */
export function pickBatchMethod(batch: ProcessBatch, methods: ProcessingMethod[]): BatchMethodRef {
  if (batch.methodSnapshot) {
    return { kind: 'snapshot', ref: batch.methodSnapshot };
  }
  const version = methods.find((m) => m.id === batch.methodId);
  return version ? { kind: 'version', ref: version } : undefined;
}
