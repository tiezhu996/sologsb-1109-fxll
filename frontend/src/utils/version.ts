import { db } from './db';
import type { FireLevel, ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';

/** 方法版本展示名，如「清炒 v2.0」 */
export function methodLabel(method: Pick<ProcessingMethod, 'name' | 'versionLabel'>): string {
  return `${method.name} ${method.versionLabel}`;
}

/** 生成方法快照：冻结方法标准内容（tempRange 为元组，单独复制） */
export function snapshotOf(method: ProcessingMethod): ProcessingMethod {
  return { ...method, tempRange: [...method.tempRange] as [number, number] };
}

/** 方法已被删除时的占位快照：保证历史批次记录不丢失、可回显 */
export function placeholderSnapshot(methodId: string, fireLevel?: FireLevel): ProcessingMethod {
  return {
    id: methodId,
    rootId: methodId,
    versionNo: 1,
    versionLabel: 'v1.0',
    effectiveAt: new Date().toISOString(),
    versionNote: '升级前初始版本（系统回填，原方法已删除）',
    name: '清炒',
    auxiliary: '无',
    auxRatio: 0,
    fireLevel: fireLevel ?? '文火',
    tempRange: [90, 150],
    duration: 12,
    criterion: '原方法已删除，判定标准不可考',
    criterionDimension: '色泽',
    applicable: '-',
  };
}

function isVersionedMethod(m: ProcessingMethod): boolean {
  return typeof m.versionNo === 'number' && typeof m.rootId === 'string' && typeof m.versionLabel === 'string';
}

/**
 * 补齐方法版本字段与批次方法快照（幂等）。
 * 用于：v3 迁移之外的兜底（如导入旧版备份），保证任何来源的旧数据都能
 * 补出可追溯的初始版本，批次判定依据不丢失。
 */
export async function ensureVersionedData(): Promise<{ methods: number; batches: number }> {
  const methods = await db.methods.toArray();
  const batches = await db.batches.toArray();
  const methodMap = new Map(methods.map((m) => [m.id, m]));

  // 各方法最早被工序引用的时间，作为初始版本生效时间的参考
  const earliestByMethod = new Map<string, string>();
  for (const b of batches) {
    const prev = earliestByMethod.get(b.methodId);
    if (!prev || b.startedAt < prev) {
      earliestByMethod.set(b.methodId, b.startedAt);
    }
  }

  let methodsTouched = 0;
  let batchesTouched = 0;

  await db.transaction('rw', db.methods, db.batches, async () => {
    for (const m of methods) {
      if (isVersionedMethod(m)) {
        continue;
      }
      m.rootId = m.id;
      m.versionNo = 1;
      m.versionLabel = 'v1.0';
      m.prevVersionId = undefined;
      m.effectiveAt = earliestByMethod.get(m.id) ?? new Date().toISOString();
      m.versionNote = m.versionNote ?? '升级前初始版本（系统回填）';
      await db.methods.put(m);
      methodsTouched += 1;
    }
    for (const b of batches) {
      if (b.methodSnapshot && isVersionedMethod(b.methodSnapshot)) {
        continue;
      }
      const ref = methodMap.get(b.methodId);
      b.methodSnapshot = ref ? snapshotOf(ref) : placeholderSnapshot(b.methodId, b.fireLevel);
      await db.batches.put(b);
      batchesTouched += 1;
    }
  });

  return { methods: methodsTouched, batches: batchesTouched };
}
