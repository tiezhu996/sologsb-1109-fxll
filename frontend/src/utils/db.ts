import Dexie, { type Table } from 'dexie';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbherbprocess-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class HerbProcessDB extends Dexie {
  herbs!: Table<HerbMaterial, string>;
  methods!: Table<ProcessingMethod, string>;
  batches!: Table<ProcessBatch, string>;
  samples!: Table<RetainSample, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      herbs: 'id, name, origin, part, batchNo, receivedAt',
      methods: 'id, name, auxiliary, fireLevel',
      batches: 'id, batchNo, herbId, methodId, degree, startedAt',
      samples: 'id, sampleNo, batchId, cabinet, retainedAt',
      meta: 'key',
    });

    // v2：批次表增加 locked 索引（锁定/质检放行查询更快），并回填历史数据的 locked 字段。
    // 升级前请在「导出备份」中导出 JSON。
    this.version(2)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('batches')
          .toCollection()
          .modify((row: ProcessBatch) => {
            if (typeof row.locked !== 'boolean') {
              row.locked = false;
            }
          });
      });

    // v3：炮制方法版本化。
    // - 升级前的方法补出「初始版本」（seriesId/status/version 及 initial 标记），原 id 与内容不变；
    // - 升级前的工序补出当时的方法快照 methodSnapshot，判定数据（得率/程度/锁定状态等）原样保留、不改判；
    // - methods 增加 seriesId/status 索引，batches 增加 methodSeriesId 索引。
    // 旧备份恢复时的回填复用 normalizeMethodVersions，规则保持一致。
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, seriesId, version, status, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, methodSeriesId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // 补初始版本：旧方法每族只有一条，就地补版本字段，不复制、不换 id
        const methods = await tx.table<ProcessingMethod, string>('methods').toArray();
        const byId = new Map<string, ProcessingMethod>();
        methods.forEach((m) => byId.set(m.id, m.seriesId ? m : { ...m, seriesId: m.id, version: 1, status: 'active', initial: true }));
        await tx
          .table('methods')
          .toCollection()
          .modify((m: ProcessingMethod) => {
            if (!m.seriesId) {
              Object.assign(m, { seriesId: m.id, version: 1, status: 'active', initial: true });
            }
          });

        // 补初始快照：仅当批次缺少快照时写入；判定数据原样保留、不改判。
        // 方法版本已删除的批次保持原状（页面显示「方法已删除」）。
        await tx
          .table('batches')
          .toCollection()
          .modify((b: ProcessBatch) => {
            if (!b.methodSeriesId) {
              b.methodSeriesId = byId.get(b.methodId)?.seriesId ?? b.methodId;
            }
            if (b.methodSnapshot) return;
            const m = byId.get(b.methodId);
            if (!m) return;
            b.methodSnapshot = {
              methodId: m.id,
              seriesId: m.seriesId,
              version: m.version,
              name: m.name,
              auxiliary: m.auxiliary,
              auxRatio: m.auxRatio,
              fireLevel: m.fireLevel,
              tempRange: m.tempRange,
              duration: m.duration,
              criterion: m.criterion,
              criterionDimension: m.criterionDimension,
              applicable: m.applicable,
              derivedFrom: m.derivedFrom,
              initial: true,
            };
          });
      });
  }
}

export const db = new HerbProcessDB();

/**
 * 为缺少版本字段的方法补初始版本、为缺少快照的批次补初始快照。
 * Dexie v3 升级与旧版备份恢复共用本逻辑；已有版本字段/快照的数据一律不动。
 */
export async function normalizeMethodVersions(): Promise<{ methods: number; batches: number }> {
  const methods = await db.methods.toArray();
  let methodPatched = 0;
  const nextMethods = methods.map((m) => {
    if (m.seriesId) return m;
    methodPatched += 1;
    return { ...m, seriesId: m.id, version: 1, status: 'active' as const, initial: true };
  });
  const byId = new Map(nextMethods.map((m) => [m.id, m]));

  const batches = await db.batches.toArray();
  let batchPatched = 0;
  const nextBatches = batches.map((b) => {
    let changed = false;
    const next: ProcessBatch = { ...b };
    if (!next.methodSeriesId) {
      next.methodSeriesId = byId.get(b.methodId)?.seriesId ?? b.methodId;
      changed = true;
    }
    if (!next.methodSnapshot) {
      const m = byId.get(b.methodId);
      if (m) {
        next.methodSnapshot = {
          methodId: m.id,
          seriesId: m.seriesId,
          version: m.version,
          name: m.name,
          auxiliary: m.auxiliary,
          auxRatio: m.auxRatio,
          fireLevel: m.fireLevel,
          tempRange: m.tempRange,
          duration: m.duration,
          criterion: m.criterion,
          criterionDimension: m.criterionDimension,
          applicable: m.applicable,
          derivedFrom: m.derivedFrom,
          initial: true,
        };
        changed = true;
      }
    }
    if (changed) batchPatched += 1;
    return next;
  });

  await db.transaction('rw', db.methods, db.batches, async () => {
    if (methodPatched > 0) await db.methods.bulkPut(nextMethods);
    if (batchPatched > 0) await db.batches.bulkPut(nextBatches);
  });
  return { methods: methodPatched, batches: batchPatched };
}

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
