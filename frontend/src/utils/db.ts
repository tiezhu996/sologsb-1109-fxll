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

    // v3：炮制方法版本化 + 批次方法快照。
    // 升级前的方法补为 v1.0 初始版本（rootId=自身 id），升级前的工序补写当时方法快照；
    // 旧批次的程度判定原样保留，不因方法后续调整而改变或丢失。
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel, rootId, versionLabel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const methodRows = (await tx.table('methods').toArray()) as ProcessingMethod[];
        const batchRows = (await tx.table('batches').toArray()) as ProcessBatch[];

        const earliestByMethod = new Map<string, string>();
        for (const b of batchRows) {
          const prev = earliestByMethod.get(b.methodId);
          if (!prev || b.startedAt < prev) {
            earliestByMethod.set(b.methodId, b.startedAt);
          }
        }

        // 回填方法：缺版本字段的一律补为 v1.0 初始版本
        for (const m of methodRows) {
          if (typeof m.versionNo !== 'number' || typeof m.rootId !== 'string') {
            m.rootId = m.id;
            m.versionNo = 1;
            m.versionLabel = 'v1.0';
            m.prevVersionId = undefined;
            m.effectiveAt = earliestByMethod.get(m.id) ?? new Date().toISOString();
            m.versionNote = m.versionNote ?? '升级前初始版本（系统回填）';
            await tx.table('methods').put(m);
          }
        }

        // 回填批次快照：以方法当前（v1.0）内容作为当时判定依据；方法已删除则占位兜底
        const methodMap = new Map(methodRows.map((m) => [m.id, m]));
        for (const b of batchRows) {
          if (b.methodSnapshot && typeof b.methodSnapshot.versionNo === 'number') {
            continue;
          }
          const ref = methodMap.get(b.methodId);
          if (ref) {
            b.methodSnapshot = { ...ref, tempRange: [...ref.tempRange] };
          } else {
            b.methodSnapshot = {
              id: b.methodId,
              rootId: b.methodId,
              versionNo: 1,
              versionLabel: 'v1.0',
              effectiveAt: new Date().toISOString(),
              versionNote: '升级前初始版本（系统回填，原方法已删除）',
              name: '清炒',
              auxiliary: '无',
              auxRatio: 0,
              fireLevel: b.fireLevel ?? '文火',
              tempRange: [90, 150],
              duration: 12,
              criterion: '原方法已删除，判定标准不可考',
              criterionDimension: '色泽',
              applicable: '-',
            } as ProcessingMethod;
          }
          await tx.table('batches').put(b);
        }
      });
  }
}

export const db = new HerbProcessDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
