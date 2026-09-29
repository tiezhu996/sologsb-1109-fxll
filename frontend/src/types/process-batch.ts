import type { FireLevel, MethodSnapshot } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/** 炮制工序记录 */
export interface ProcessBatch {
  id: string;
  /** 生产批号 */
  batchNo: string;
  /** 关联药材 */
  herbId: string;
  /** 采用的具体方法版本 id */
  methodId: string;
  /** 方法族 id（便于按方法族查询各版本使用情况） */
  methodSeriesId: string;
  /** 保存当时的方法快照：辅料比例、火候与判定依据均以此为准 */
  methodSnapshot: MethodSnapshot;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg: number;
  /** 火候 */
  fireLevel: FireLevel;
  /** 开始时间 ISO */
  startedAt: string;
  /** 结束时间 ISO */
  endedAt: string;
  /** 得率（%） */
  yieldRate: number;
  /** 程度判定 */
  degree: ProcessDegree;
  /** 操作人 */
  operator: string;
  /** 得率与程度提交后锁定，仅质检员可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 质检员放行/改判人 */
  qcBy?: string;
  /** 备注 */
  remark?: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];
