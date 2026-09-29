/** 火力等级 */
export type FireLevel = '文火' | '中火' | '武火';

/** 炮制方法类别 */
export type MethodName =
  | '清炒'
  | '麸炒'
  | '酒炙'
  | '醋炙'
  | '盐炙'
  | '蜜炙'
  | '蒸'
  | '煮'
  | '燀'
  | '煅';

/** 辅料 */
export type Auxiliary = '无' | '黄酒' | '米醋' | '食盐' | '蜂蜜' | '麦麸' | '灶心土';

/** 判断标准维度 */
export type CriterionDimension = '色泽' | '气味' | '断面';

/** 方法版本状态：active=当前生效版本，superseded=已被新版本替代（仅供历史批次追溯） */
export type MethodVersionStatus = 'active' | 'superseded';

/** 炮制方法（辅料比例 / 火候 / 判断标准），同一方法的每次修订为一个版本 */
export interface ProcessingMethod {
  id: string;
  /** 方法族 id：同一方法的全部版本共享，首版等于 id */
  seriesId: string;
  /** 版本号（同一方法族内从 1 递增） */
  version: number;
  /** 版本状态 */
  status: MethodVersionStatus;
  /** 方法名 */
  name: MethodName;
  /** 辅料 */
  auxiliary: Auxiliary;
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 火力 */
  fireLevel: FireLevel;
  /** 温度区间（℃），[下限, 上限] */
  tempRange: [number, number];
  /** 炮制时间（min） */
  duration: number;
  /** 判断标准：色泽 / 气味 / 断面 */
  criterion: string;
  /** 判断标准侧重维度 */
  criterionDimension: CriterionDimension;
  /** 适用药材说明 */
  applicable: string;
  /** 是否为派生方法（由某个具体方法版本复制派生而来，保存的是源版本 id） */
  derivedFrom?: string;
  /** 本版本变更说明（生成新版本时填写） */
  changeNote?: string;
  /** 版本生效时间 ISO */
  createdAt?: string;
  /** 被新版本替代的时间 ISO */
  supersededAt?: string;
  /** 升级前存量方法补出的初始版本标记 */
  initial?: boolean;
}

/** 批次保存时冻结的方法快照：此后方法再修订也不影响历史批次 */
export interface MethodSnapshot {
  /** 引用的具体方法版本 id（= ProcessBatch.methodId） */
  methodId: string;
  /** 方法族 id */
  seriesId: string;
  /** 保存时的版本号 */
  version: number;
  name: MethodName;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempRange: [number, number];
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
  /** 派生来源的方法版本 id */
  derivedFrom?: string;
  /** 升级前存量批次补出的初始快照标记 */
  initial?: boolean;
}

/** 由方法版本生成不可变快照 */
export function toMethodSnapshot(method: ProcessingMethod): MethodSnapshot {
  return {
    methodId: method.id,
    seriesId: method.seriesId,
    version: method.version,
    name: method.name,
    auxiliary: method.auxiliary,
    auxRatio: method.auxRatio,
    fireLevel: method.fireLevel,
    tempRange: method.tempRange,
    duration: method.duration,
    criterion: method.criterion,
    criterionDimension: method.criterionDimension,
    applicable: method.applicable,
    derivedFrom: method.derivedFrom,
    initial: method.initial,
  };
}

/** 版本号文案，如 v2 */
export function methodVersionTag(version: number): string {
  return `v${version}`;
}

/** 方法完整称谓，如「酒炙 v2」 */
export function methodFullLabel(ref: { name: string; version: number }): string {
  return `${ref.name} ${methodVersionTag(ref.version)}`;
}

export const FIRE_LEVELS: FireLevel[] = ['文火', '中火', '武火'];
export const METHOD_NAMES: MethodName[] = [
  '清炒',
  '麸炒',
  '酒炙',
  '醋炙',
  '盐炙',
  '蜜炙',
  '蒸',
  '煮',
  '燀',
  '煅',
];
export const AUXILIARIES: Auxiliary[] = ['无', '黄酒', '米醋', '食盐', '蜂蜜', '麦麸', '灶心土'];
export const CRITERION_DIMENSIONS: CriterionDimension[] = ['色泽', '气味', '断面'];
