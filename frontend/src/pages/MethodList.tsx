import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { formatDate } from '../utils/degree';
import { methodLabel } from '../utils/version';
import {
  AUXILIARIES,
  CRITERION_DIMENSIONS,
  FIRE_LEVELS,
  METHOD_NAMES,
  type Auxiliary,
  type CriterionDimension,
  type FireLevel,
  type MethodName,
  type ProcessingMethod,
} from '../types/processing-method';

const { Title, Paragraph, Text } = Typography;

interface MethodFormValues {
  name: MethodName;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempMin: number;
  tempMax: number;
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
  versionNote?: string;
}

/** 炮制方法与辅料比例：按投料量折算用量，按版本管理调整历史 */
export default function MethodList() {
  const { message, modal } = AntApp.useApp();
  const allMethods = useMethodStore((s) => s.methods);
  const addMethod = useMethodStore((s) => s.addMethod);
  const updateMethod = useMethodStore((s) => s.updateMethod);
  const removeMethod = useMethodStore((s) => s.removeMethod);
  const deriveMethod = useMethodStore((s) => s.deriveMethod);
  const latestMethods = useMethodStore((s) => s.latestMethods);
  const versionsOf = useMethodStore((s) => s.versionsOf);
  const batches = useBatchStore((s) => s.batches);

  const methods = useMemo(() => latestMethods(), [latestMethods, allMethods]);
  const usageOf = (id: string) => batches.filter((b) => b.methodId === id).length;
  const findMethod = (id?: string) => allMethods.find((m) => m.id === id);

  const [form] = Form.useForm<MethodFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessingMethod | null>(null);

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriveSource, setDeriveSource] = useState<ProcessingMethod | null>(null);
  const [deriveForm] = Form.useForm<{ name: MethodName; auxRatio: number }>();

  const [calcMethodId, setCalcMethodId] = useState<string>(methods[0]?.id ?? '');
  const [calcFeedKg, setCalcFeedKg] = useState<number>(100);
  const [calcAuxUsedKg, setCalcAuxUsedKg] = useState<number>(0);
  const [calcOutputKg, setCalcOutputKg] = useState<number>(94);

  const calcMethod = useMemo(
    () => methods.find((m) => m.id === calcMethodId) ?? methods[0],
    [methods, calcMethodId],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '清炒', auxiliary: '无', auxRatio: 0, fireLevel: '文火', tempMin: 90, tempMax: 120, duration: 12, criterionDimension: '色泽' } as unknown as MethodFormValues);
    setOpen(true);
  };

  const openEdit = (record: ProcessingMethod) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      auxiliary: record.auxiliary,
      auxRatio: record.auxRatio,
      fireLevel: record.fireLevel,
      tempMin: record.tempRange[0],
      tempMax: record.tempRange[1],
      duration: record.duration,
      criterion: record.criterion,
      criterionDimension: record.criterionDimension,
      applicable: record.applicable,
      versionNote: record.versionNote,
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (values.tempMin > values.tempMax) {
      message.error('温度下限不能高于上限');
      return;
    }
    const payload = {
      name: values.name,
      auxiliary: values.auxiliary,
      auxRatio: values.auxRatio,
      fireLevel: values.fireLevel,
      tempRange: [values.tempMin, values.tempMax] as [number, number],
      duration: values.duration,
      criterion: values.criterion,
      criterionDimension: values.criterionDimension,
      applicable: values.applicable,
      versionNote: values.versionNote?.trim() || undefined,
    };

    const doSave = async () => {
      if (editing) {
        const result = await updateMethod(editing.id, payload);
        if (result?.created === 'new-version') {
          message.success(
            `已生成新版本 ${result.method.versionLabel}：仅后续批次按新标准选择，历史批次仍按 ${editing.versionLabel} 判定`,
          );
        } else {
          message.success(`已更新方法 ${payload.name}（未被工序引用，原地更新）`);
        }
      } else {
        await addMethod(payload);
        message.success(`已新增方法 ${payload.name} v1.0`);
      }
      setOpen(false);
    };

    if (editing && usageOf(editing.id) > 0) {
      const used = usageOf(editing.id);
      modal.confirm({
        title: `已有 ${used} 批工序引用，修改将生成新版本`,
        content: `保存后将生成 ${methodLabel(editing)} 的下一版本：历史批次已冻结 ${editing.versionLabel} 方法快照，仍按原标准判定与回显；新版本仅供后续批次选择。是否继续？`,
        okText: '生成新版本',
        cancelText: '取消',
        onOk: doSave,
      });
      return;
    }
    await doSave();
  };

  const openDerive = (record: ProcessingMethod) => {
    setDeriveSource(record);
    deriveForm.resetFields();
    deriveForm.setFieldsValue({ name: record.name, auxRatio: record.auxRatio });
    setDeriveOpen(true);
  };

  const submitDerive = async () => {
    if (!deriveSource) return;
    const values = await deriveForm.validateFields();
    const created = await deriveMethod(deriveSource.id, values.name, values.auxRatio);
    if (created) {
      message.success(`已从「${methodLabel(deriveSource)}」派生新方法（辅料比例 ${values.auxRatio}kg/100kg）`);
      setCalcMethodId(created.id);
    }
    setDeriveOpen(false);
  };

  const columns: TableColumnsType<ProcessingMethod> = [
    {
      title: '方法',
      dataIndex: 'name',
      width: 110,
      render: (v: string, record) => (
        <Space size={4}>
          <Text strong>{v}</Text>
          {record.derivedFrom ? <Tag color="blue">派生</Tag> : null}
        </Space>
      ),
    },
    {
      title: '当前版本',
      dataIndex: 'versionLabel',
      width: 100,
      render: (v: string) => <Tag color="green">{v}</Tag>,
    },
    { title: '辅料', dataIndex: 'auxiliary', width: 80 },
    { title: '每100kg用量(kg)', dataIndex: 'auxRatio', width: 140, align: 'right' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 190,
      render: (v: FireLevel, record) => <FireLevelTag level={v} tempRange={record.tempRange} duration={record.duration} />,
    },
    { title: '判断标准', dataIndex: 'criterion', ellipsis: true, render: (v: string, record) => <span>{v}<Tag style={{ marginLeft: 6 }}>{record.criterionDimension}</Tag></span> },
    { title: '适用药材', dataIndex: 'applicable', width: 160, ellipsis: true },
    {
      title: '引用批次',
      width: 90,
      align: 'right',
      render: (_, record) => {
        const n = usageOf(record.id);
        return n > 0 ? <Tag color="orange">{n} 批</Tag> : <Text type="secondary">未引用</Text>;
      },
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => { setCalcMethodId(record.id); setCalcAuxUsedKg(Number(((calcFeedKg * record.auxRatio) / 100).toFixed(2))); }}>
            折算
          </Button>
          <Button size="small" type="link" onClick={() => openDerive(record)}>
            复制派生
          </Button>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除方法「${methodLabel(record)}」？`}
            description={usageOf(record.id) > 0 ? '该版本已被工序引用，将无法删除' : '仅删除该版本，不影响其他版本'}
            onConfirm={async () => {
              const result = await removeMethod(record.id);
              if (result.ok) {
                message.success('已删除');
              } else {
                message.error(result.reason ?? '删除失败');
              }
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /** 版本历史展开行：同一版本链的全部版本，按版本号升序 */
  const expandedRowRender = (record: ProcessingMethod) => {
    const versions = versionsOf(record.rootId);
    const versionColumns: TableColumnsType<ProcessingMethod> = [
      {
        title: '版本',
        dataIndex: 'versionLabel',
        width: 110,
        render: (v: string, row) => (
          <Space size={4}>
            <Tag color={row.id === record.id ? 'green' : 'default'}>{v}</Tag>
            {row.id === record.id ? <Text type="secondary">当前</Text> : null}
          </Space>
        ),
      },
      { title: '生效时间', dataIndex: 'effectiveAt', width: 120, render: (v: string) => formatDate(v) },
      { title: '版本说明', dataIndex: 'versionNote', ellipsis: true, render: (v?: string) => v ?? '-' },
      {
        title: '派生自',
        dataIndex: 'derivedFrom',
        width: 140,
        render: (v?: string) => (v && findMethod(v) ? methodLabel(findMethod(v)!) : '-'),
      },
      { title: '引用批次', width: 90, align: 'right', render: (_, row) => `${usageOf(row.id)} 批` },
      {
        title: '标准摘要',
        render: (_, row) => (
          <Text type="secondary">
            {row.auxiliary !== '无' ? `${row.auxiliary} ${row.auxRatio}kg/100kg · ` : ''}
            {row.fireLevel} · {row.tempRange[0]}~{row.tempRange[1]}℃ · {row.duration}min · {row.criterion}
          </Text>
        ),
      },
    ];
    return (
      <Table
        rowKey="id"
        size="small"
        columns={versionColumns}
        dataSource={versions}
        pagination={false}
        locale={{ emptyText: '暂无历史版本' }}
      />
    );
  };

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制方法与辅料比例
      </Title>
      <Paragraph type="secondary">
        选择方法即带出辅料比例、火候与判断标准；支持按投料量折算辅料用量与反向推算。方法按版本管理：已有工序引用的方法修改后生成新版本，历史批次仍按原版本标准判定与回显。
      </Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="辅料折算台"
            extra={<Text type="secondary">反向推算：输入现有辅料量可算出最大投料量</Text>}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <span style={{ color: '#6b7a70' }}>炮制方法</span>
                <Select
                  style={{ width: 220 }}
                  value={calcMethod?.id}
                  onChange={(value: string) => {
                    setCalcMethodId(value);
                    const target = methods.find((m) => m.id === value);
                    if (target) {
                      setCalcAuxUsedKg(Number(((calcFeedKg * target.auxRatio) / 100).toFixed(2)));
                      setCalcOutputKg(Number(((calcFeedKg * (target.name === '蜜炙' ? 1.08 : 0.94))).toFixed(2)));
                    }
                  }}
                  options={methods.map((m) => ({ label: `${m.name} ${m.versionLabel} · ${m.auxiliary}`, value: m.id }))}
                />
                {calcMethod ? <FireLevelTag level={calcMethod.fireLevel} tempRange={calcMethod.tempRange} duration={calcMethod.duration} /> : null}
              </Space>
              {calcMethod ? (
                <>
                  <Text type="secondary">判断标准：{calcMethod.criterion}（{calcMethod.criterionDimension}）</Text>
                  <RatioCalculator
                    auxRatio={calcMethod.auxRatio}
                    auxiliary={calcMethod.auxiliary}
                    feedKg={calcFeedKg}
                    auxUsedKg={calcAuxUsedKg}
                    outputKg={calcOutputKg}
                    onChange={(patch) => {
                      if (patch.feedKg !== undefined) {
                        setCalcFeedKg(patch.feedKg);
                        setCalcAuxUsedKg(Number(((patch.feedKg * calcMethod.auxRatio) / 100).toFixed(2)));
                        setCalcOutputKg(Number((patch.feedKg * (calcMethod.name === '蜜炙' ? 1.08 : 0.94)).toFixed(2)));
                      }
                      if (patch.auxUsedKg !== undefined) {
                        setCalcAuxUsedKg(patch.auxUsedKg);
                      }
                    }}
                  />
                  <Space wrap>
                    <span style={{ color: '#6b7a70' }}>炮制后重量</span>
                    <InputNumber min={0} step={0.5} value={calcOutputKg} addonAfter="kg" style={{ width: 150 }} onChange={(v) => setCalcOutputKg(Number(v) || 0)} />
                  </Space>
                </>
              ) : (
                <Text type="secondary">暂无炮制方法，请先新增</Text>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="方法一览（当前版本）" extra={<Button size="small" type="primary" onClick={openCreate}>新增方法</Button>}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {methods.slice(0, 8).map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    <Tag color="green">{m.name} {m.versionLabel}</Tag>
                    {m.auxiliary !== '无' ? `${m.auxiliary} ${m.auxRatio}kg/100kg` : '不辅以辅料'}
                  </span>
                  <Text type="secondary">{m.tempRange[0]}~{m.tempRange[1]}℃ · {m.duration}min</Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={methods}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1300 }}
        expandable={{ expandedRowRender, rowExpandable: () => true }}
      />

      <Modal open={open} title={editing ? `编辑炮制方法 · ${methodLabel(editing)}` : '新增炮制方法'} onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={640}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="方法名" rules={[{ required: true, message: '请选择方法名' }]}>
                <Select options={METHOD_NAMES.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="auxiliary" label="辅料" rules={[{ required: true, message: '请选择辅料' }]}>
                <Select options={AUXILIARIES.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="auxRatio" label="每100kg药材用量(kg)" rules={[{ required: true, message: '请输入用量' }]}>
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
                <Select options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tempMin" label="温度下限(℃)" rules={[{ required: true, message: '请输入温度下限' }]}>
                <InputNumber min={0} max={800} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tempMax" label="温度上限(℃)" rules={[{ required: true, message: '请输入温度上限' }]}>
                <InputNumber min={0} max={800} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="duration" label="时间(min)" rules={[{ required: true, message: '请输入时间' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="criterionDimension" label="判断标准侧重" rules={[{ required: true, message: '请选择判断维度' }]}>
                <Select options={CRITERION_DIMENSIONS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="criterion" label="判断标准" rules={[{ required: true, message: '请输入判断标准' }]}>
            <Input placeholder="如：表面微黄、气香、断面颜色加深" maxLength={60} />
          </Form.Item>
          <Form.Item name="applicable" label="适用药材" rules={[{ required: true, message: '请输入适用药材' }]}>
            <Input placeholder="如：白术、黄芪" maxLength={60} />
          </Form.Item>
          <Form.Item name="versionNote" label="版本说明" tooltip="记录本次调整原因，如「夏季辅料比例调整」「按季节切换」；生成新版本后随版本留痕">
            <Input placeholder="如：夏季高温，辅料比例下调 2%" maxLength={60} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={deriveOpen} title={`复制派生 · 源方法 ${deriveSource ? methodLabel(deriveSource) : ''}`} onCancel={() => setDeriveOpen(false)} onOk={submitDerive} okText="派生新方法" cancelText="取消">
        <Form form={deriveForm} layout="vertical">
          <Form.Item name="name" label="新方法名" rules={[{ required: true, message: '请选择方法名' }]}>
            <Select options={METHOD_NAMES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="auxRatio" label="辅料比例(每100kg用量 kg)" rules={[{ required: true, message: '请输入辅料比例' }]}>
            <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">派生会复制火候、温度区间与判断标准，仅辅料比例可按需调整；派生关系指向源方法的具体版本。</Text>
        </Form>
      </Modal>
    </div>
  );
}
