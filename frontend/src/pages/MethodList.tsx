import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Timeline, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import { useMethodStore, selectLatestMethods, selectSeriesVersions } from '../stores/methodStore';
import {
  AUXILIARIES,
  CRITERION_DIMENSIONS,
  FIRE_LEVELS,
  METHOD_NAMES,
  methodFullLabel,
  methodVersionTag,
  type Auxiliary,
  type CriterionDimension,
  type FireLevel,
  type MethodName,
  type ProcessingMethod,
} from '../types/processing-method';
import { formatDate } from '../utils/degree';

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
  changeNote?: string;
}

/** 炮制方法与辅料比例：按投料量折算用量并可复制派生；修订按版本留存 */
export default function MethodList() {
  const { message } = AntApp.useApp();
  const methods = useMethodStore((s) => s.methods);
  const addMethod = useMethodStore((s) => s.addMethod);
  const updateMethod = useMethodStore((s) => s.updateMethod);
  const removeSeries = useMethodStore((s) => s.removeSeries);
  const isSeriesUsed = useMethodStore((s) => s.isSeriesUsed);
  const deriveMethod = useMethodStore((s) => s.deriveMethod);

  // 方法表按版本留存，主列表只展示各方法族当前生效版本
  const latestMethods = useMemo(() => selectLatestMethods(methods), [methods]);

  const [form] = Form.useForm<MethodFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessingMethod | null>(null);
  /** 被编辑方法族是否已被工序引用（决定原地更新还是生成新版本），打开编辑框时确定 */
  const [editingUsed, setEditingUsed] = useState(false);

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriveSource, setDeriveSource] = useState<ProcessingMethod | null>(null);
  const [deriveForm] = Form.useForm<{ name: MethodName; auxRatio: number }>();

  const [historySeries, setHistorySeries] = useState<ProcessingMethod | null>(null);
  const historyVersions = useMemo(
    () => (historySeries ? selectSeriesVersions(methods, historySeries.seriesId) : []),
    [methods, historySeries],
  );

  const [calcMethodId, setCalcMethodId] = useState<string>(latestMethods[0]?.id ?? '');
  const [calcFeedKg, setCalcFeedKg] = useState<number>(100);
  const [calcAuxUsedKg, setCalcAuxUsedKg] = useState<number>(0);
  const [calcOutputKg, setCalcOutputKg] = useState<number>(94);

  const calcMethod = useMemo(
    () => latestMethods.find((m) => m.id === calcMethodId) ?? latestMethods[0],
    [latestMethods, calcMethodId],
  );

  const openCreate = () => {
    setEditing(null);
    setEditingUsed(false);
    form.resetFields();
    form.setFieldsValue({ name: '清炒', auxiliary: '无', auxRatio: 0, fireLevel: '文火', tempMin: 90, tempMax: 120, duration: 12, criterionDimension: '色泽' } as unknown as MethodFormValues);
    setOpen(true);
  };

  const openEdit = async (record: ProcessingMethod) => {
    setEditing(record);
    form.resetFields();
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
      changeNote: undefined,
    });
    setEditingUsed(await isSeriesUsed(record.seriesId));
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
    };
    if (editing) {
      if (editingUsed && !values.changeNote?.trim()) {
        message.warning('该方法已被工序引用，修订将生成新版本，请填写变更说明');
        return;
      }
      const outcome = await updateMethod(editing.id, payload, values.changeNote);
      if (!outcome) {
        message.error('该版本为历史版本，不能再修改');
        return;
      }
      if (outcome.mode === 'fork') {
        message.success(`已生成 ${methodFullLabel(outcome.method)}，旧版本保留备查；历史批次仍沿用旧版，仅后续批次可选新版`);
        setCalcMethodId(outcome.method.id);
      } else {
        message.success(`已原地更新方法 ${payload.name}（尚未被工序引用，未生成新版本）`);
      }
    } else {
      const created = await addMethod(payload);
      message.success(`已新增方法 ${methodFullLabel(created)}`);
      setCalcMethodId(created.id);
    }
    setOpen(false);
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
      message.success(`已从「${methodFullLabel(deriveSource)}」派生新方法 ${methodFullLabel(created)}（辅料比例 ${values.auxRatio}kg/100kg）`);
      setCalcMethodId(created.id);
    }
    setDeriveOpen(false);
  };

  const handleDelete = async (record: ProcessingMethod) => {
    try {
      await removeSeries(record.seriesId);
      message.success('已删除该方法族');
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: TableColumnsType<ProcessingMethod> = [
    {
      title: '方法',
      dataIndex: 'name',
      width: 130,
      render: (v: string, record) => (
        <Space size={4}>
          <Text strong>{v}</Text>
          <Tag>{methodVersionTag(record.version)}</Tag>
          {record.initial ? <Tag color="gold">初始版本</Tag> : null}
          {record.derivedFrom ? <Tag color="blue">派生</Tag> : null}
        </Space>
      ),
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
      title: '生效时间',
      dataIndex: 'createdAt',
      width: 120,
      render: (v?: string) => (v ? formatDate(v) : <Text type="secondary">升级前存量</Text>),
    },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => { setCalcMethodId(record.id); setCalcAuxUsedKg(Number(((calcFeedKg * record.auxRatio) / 100).toFixed(2))); }}>
            折算
          </Button>
          <Button size="small" type="link" onClick={() => openDerive(record)}>
            复制派生
          </Button>
          <Button size="small" type="link" onClick={() => setHistorySeries(record)}>
            版本记录
          </Button>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title={`确认删除方法族「${record.name}」？`} description="仅未被工序引用的方法可删除" onConfirm={() => handleDelete(record)}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制方法与辅料比例
      </Title>
      <Paragraph type="secondary">
        选择方法即带出辅料比例、火候与判断标准；支持按投料量折算辅料用量与反向推算。修订规则：未被工序引用的修改原地保存；已被工序引用的方法修订后生成新版本，历史批次仍按保存时的版本与判定依据回显，新版本仅供后续批次选择。
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
                    const target = latestMethods.find((m) => m.id === value);
                    if (target) {
                      setCalcAuxUsedKg(Number(((calcFeedKg * target.auxRatio) / 100).toFixed(2)));
                      setCalcOutputKg(Number(((calcFeedKg * (target.name === '蜜炙' ? 1.08 : 0.94))).toFixed(2)));
                    }
                  }}
                  options={latestMethods.map((m) => ({ label: `${methodFullLabel(m)} · ${m.auxiliary}`, value: m.id }))}
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
          <Card size="small" title="当前生效方法" extra={<Button size="small" type="primary" onClick={openCreate}>新增方法</Button>}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {latestMethods.slice(0, 8).map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    <Tag color="green">{methodFullLabel(m)}</Tag>
                    {m.auxiliary !== '无' ? `${m.auxiliary} ${m.auxRatio}kg/100kg` : '不辅以辅料'}
                  </span>
                  <Text type="secondary">{m.tempRange[0]}~{m.tempRange[1]}℃ · {m.duration}min</Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Table rowKey="id" size="small" columns={columns} dataSource={latestMethods} pagination={{ pageSize: 10 }} scroll={{ x: 1400 }} />

      <Modal
        open={open}
        title={editing ? `编辑炮制方法 · ${methodFullLabel(editing)}` : '新增炮制方法'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        {editing && editingUsed ? (
          <Paragraph type="warning" style={{ marginBottom: 12 }}>
            该方法已被工序引用：保存后当前版本将停用并保留（历史批次继续沿用），同时生成新版本仅供后续批次选择。请填写变更说明。
          </Paragraph>
        ) : editing ? (
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            该方法尚未被工序引用，本次修改将原地更新，不生成新版本。
          </Paragraph>
        ) : null}
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
          <Form.Item name="criterion" label="判断标准（原始判定依据随版本留存）" rules={[{ required: true, message: '请输入判断标准' }]}>
            <Input placeholder="如：表面微黄、气香、断面颜色加深" maxLength={60} />
          </Form.Item>
          <Form.Item name="applicable" label="适用药材" rules={[{ required: true, message: '请输入适用药材' }]}>
            <Input placeholder="如：白术、黄芪" maxLength={60} />
          </Form.Item>
          {editing && editingUsed ? (
            <Form.Item name="changeNote" label="变更说明" rules={[{ required: true, message: '请填写本次修订的变更说明' }]}>
              <Input placeholder="如：因入冬调整温度下限与炮制时长" maxLength={60} />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal open={deriveOpen} title={`复制派生 · 源方法 ${deriveSource ? methodFullLabel(deriveSource) : ''}`} onCancel={() => setDeriveOpen(false)} onOk={submitDerive} okText="派生新方法" cancelText="取消">
        <Form form={deriveForm} layout="vertical">
          <Form.Item name="name" label="新方法名" rules={[{ required: true, message: '请选择方法名' }]}>
            <Select options={METHOD_NAMES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="auxRatio" label="辅料比例(每100kg用量 kg)" rules={[{ required: true, message: '请输入辅料比例' }]}>
            <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">派生会复制源版本的火候、温度区间与判断标准，另立为新方法族（v1），仅辅料比例可按需调整；源版本与其判定依据保持不变。</Text>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(historySeries)}
        title={`版本记录 · ${historySeries?.name ?? ''}`}
        width={560}
        onClose={() => setHistorySeries(null)}
      >
        <Timeline
          items={historyVersions
            .slice()
            .reverse()
            .map((m) => ({
              color: m.status === 'active' ? 'green' : 'gray',
              children: (
                <Card size="small" style={{ marginBottom: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>{methodFullLabel(m)}</Text>
                    <Tag color={m.status === 'active' ? 'green' : 'default'}>{m.status === 'active' ? '当前生效' : '已停用'}</Tag>
                    {m.initial ? <Tag color="gold">初始版本</Tag> : null}
                    {m.derivedFrom ? <Tag color="blue">派生自具体版本</Tag> : null}
                  </Space>
                  <Descriptions column={1} size="small" styles={{ label: { width: 92 } }}>
                    <Descriptions.Item label="辅料">{m.auxiliary} {m.auxRatio}kg/100kg</Descriptions.Item>
                    <Descriptions.Item label="火候">{m.fireLevel} · {m.tempRange[0]}~{m.tempRange[1]}℃ · {m.duration}min</Descriptions.Item>
                    <Descriptions.Item label="判定依据">{m.criterion}（{m.criterionDimension}）</Descriptions.Item>
                    <Descriptions.Item label="适用药材">{m.applicable}</Descriptions.Item>
                    <Descriptions.Item label="派生来源">
                      {m.derivedFrom
                        ? (() => {
                            const src = methods.find((x) => x.id === m.derivedFrom);
                            return src ? methodFullLabel(src) : `版本 ${m.derivedFrom}（已删除）`;
                          })()
                        : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="变更说明">{m.changeNote ?? '—'}</Descriptions.Item>
                    <Descriptions.Item label="生效时间">{m.createdAt ? formatDate(m.createdAt) : '升级前存量方法'}</Descriptions.Item>
                    <Descriptions.Item label="停用时间">{m.supersededAt ? formatDate(m.supersededAt) : '—'}</Descriptions.Item>
                  </Descriptions>
                </Card>
              ),
            }))}
        />
      </Drawer>
    </div>
  );
}
