import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useDb } from '@/app/providers/DbProvider';
import { deleteSecret, getSecret, putSecret } from '@/data/repos/secretRepo';
import { maskedKeyLabel } from '@/domain/settings/secrets';
import type { AiConfig } from '@/domain/settings/types';
import { streamChat } from '@/services/llm/client';
import {
  AI_ENABLED,
  API_KEY_SECRET_ID,
  isSecureBaseUrl,
} from '@/services/translationScorerRegistry';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Switch } from '@/ui/primitives';

/**
 * AI 批改配置卡（docs/04b §5.14.9 / V-18）。
 *
 * 🔴 四条纪律，改动前先读 §5.14.9：
 *   1. 四段安全文案**逐字呈现**，不折叠、不塞 tooltip、不改写；
 *   2. `http://` 一律拒绝，且拒绝时**不发出任何请求**；
 *   3. API Key 用 `type="password"`，已保存时只显示 `已保存（••••3f2a）`，永不回显明文；
 *   4. 「测试连接」只在用户点击时触发，且 `max_tokens: 8`（只为验证连通性，不浪费额度）。
 *
 * ★ 明文 Key 只写 `secrets` 表（SECRET_STORES）；`UserSettings.aiConfig` 里
 *   **只有 keyId 引用** —— 因此导出备份结构上不可能带走它。
 */

/** 🔴 §5.14.9 第一段：配置卡顶部（常驻，非折叠） */
const NOTICE_TOP =
  'API Key 只保存在你这台设备的浏览器（IndexedDB）里，不会上传给本站或任何第三方——本站是纯前端，没有服务器，也看不到你的 Key。';

/** 🔴 §5.14.9 第二段：Key 输入框下方 */
const NOTICE_KEY =
  '⚠️ 风险自担：请勿使用不限额度、不限权限的主 Key。建议单独创建一个限模型 + 限额度的 Key，用完可随时在下方删除。若 Key 泄露或被盗用造成损失，由你自行承担。';

/** 🔴 §5.14.9 第三段：开关下方（开启时） */
const NOTICE_ENABLED =
  '开启后，你的译文原文与题目内容会被发送到你配置的 AI 服务商（请求由你的浏览器直接发出）。如介意，请保持关闭——离线评分功能不受任何影响。';

/** 🔴 §5.14.9 第四段：「删除 Key」按钮旁 */
const NOTICE_DELETE = '删除后本地不留任何痕迹，导出备份中也不会包含。';

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string };

export function AiConfigCard(): ReactNode {
  const instance = useDb();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const config = settings.aiConfig;

  const [keyDraft, setKeyDraft] = useState('');
  /**
   * 🔴 只保存**掩码后的文案**（`已保存（••••3f2a）`），绝不把明文 Key 放进 state：
   *   React DevTools 能直接读 state，明文进去就等于把它摊在了屏幕上。
   */
  const [keyLabel, setKeyLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 挂载时算一次掩码文案。
   *
   * ★ 明文只在函数局部出现一次（`maskedKeyLabel` 的入参），算完即随作用域丢弃；
   *   之所以不干脆只存「有/没有」而多这一步：用户手上有多个 Key 时，
   *   尾部 4 位是唯一能确认"我存的是哪一个"的办法。
   */
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const secret = await getSecret(config.keyId ?? API_KEY_SECRET_ID, instance);
      if (!cancelled) setKeyLabel(maskedKeyLabel(secret));
    })();
    return () => {
      cancelled = true;
    };
  }, [config.keyId, instance]);

  const patch = useCallback(
    (next: Partial<AiConfig>): void => {
      void update({ aiConfig: { ...config, ...next } });
    },
    [config, update],
  );

  const baseUrlInvalid = config.baseUrl.trim().length > 0 && !isSecureBaseUrl(config.baseUrl);

  const handleSaveKey = useCallback((): void => {
    const value = keyDraft.trim();
    if (value.length === 0) {
      setNotice('请先粘贴 API Key');
      return;
    }
    setSaving(true);
    void (async (): Promise<void> => {
      try {
        await putSecret(API_KEY_SECRET_ID, value, instance);
        // ★ 只把"引用"写进设置；`keyId` 是固定常量，不是明文
        patch({ keyId: API_KEY_SECRET_ID });
        setKeyLabel(maskedKeyLabel(value));
        setKeyDraft('');
        setNotice('已保存');
        setTest({ kind: 'idle' });
      } finally {
        setSaving(false);
      }
    })();
  }, [keyDraft, instance, patch]);

  const handleDeleteKey = useCallback((): void => {
    void (async (): Promise<void> => {
      await deleteSecret(API_KEY_SECRET_ID, instance);
      //★ 显式写回一份"无 keyId"的配置；只删 secrets 行会让设置里留下悬空引用
      patch({ keyId: undefined });
      setKeyLabel(null);
      setKeyDraft('');
      setNotice('已删除');
      setTest({ kind: 'idle' });
    })();
  }, [instance, patch]);

  const handleTest = useCallback((): void => {
    // 🔴 校验在前：**http:// 一律拒绝，且此时一个请求都不发**
    if (!isSecureBaseUrl(config.baseUrl)) {
      setTest({ kind: 'failed', message: 'Base URL 必须是 https://' });
      return;
    }
    if (config.model.trim().length === 0) {
      setTest({ kind: 'failed', message: '请先填写模型名' });
      return;
    }
    setTest({ kind: 'running' });
    void (async (): Promise<void> => {
      try {
        const apiKey = await getSecret(config.keyId ?? API_KEY_SECRET_ID, instance);
        if (!apiKey) {
          setTest({ kind: 'failed', message: '还没有保存 API Key' });
          return;
        }
        await streamChat(
          {
            baseUrl: config.baseUrl,
            model: config.model,
            apiKey,
            // ★ 只验证连通性：8 个 token 足够返回一点内容，浪费额度最小
            maxTokens: 8,
            temperature: 0,
            messages: [{ role: 'user', content: 'ping' }],
          },
          () => undefined,
        );
        setTest({ kind: 'ok' });
      } catch (e) {
        setTest({
          kind: 'failed',
          message: e instanceof Error && e.message ? e.message : '连接失败',
        });
      }
    })();
  }, [config, instance]);

  // 全局开关关闭时（回滚 AI），整张卡只留一句说明，不给任何可点的配置入口
  if (!AI_ENABLED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI 批改</CardTitle>
          <Badge tone="neutral">已关闭</Badge>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            当前版本未启用 AI 批改，翻译训练使用离线关键词评分，功能完整可用。
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 批改</CardTitle>
        <Badge tone={config.enabled ? 'warning' : 'neutral'}>
          {config.enabled ? '已开启' : '未开启'}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 🔴 第一段（常驻）*/}
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            AI 批改需要你自己的 Key
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{NOTICE_TOP}</p>
        </div>

        <Switch
          label="启用 AI 批改"
          description="关闭时零网络请求，离线评分照常工作"
          checked={config.enabled}
          onChange={(v): void => patch({ enabled: v })}
        />

        {/* 🔴 第三段（仅开启时出现）*/}
        {config.enabled ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{NOTICE_ENABLED}</p>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
            Base URL
          </label>
          <input
            type="url"
            inputMode="url"
            value={config.baseUrl}
            onChange={(e): void => patch({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          {baseUrlInvalid ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              必须以 https:// 开头 —— 明文 http 会把你的 Key 直接暴露在网络上。
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
            模型名
          </label>
          <input
            type="text"
            value={config.model}
            onChange={(e): void => patch({ model: e.target.value })}
            placeholder="例如 gpt-4o-mini"
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-800 dark:text-slate-100">
              API Key
            </label>
            {keyLabel && keyLabel !== '未保存' ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{keyLabel}</span>
            ) : null}
          </div>
          {/* 🔴 type="password"：绝不回显，也绝不因为"想确认粘对了"而解密 */}
          <input
            type="password"
            value={keyDraft}
            onChange={(e): void => setKeyDraft(e.target.value)}
            placeholder={keyLabel && keyLabel !== '未保存' ? '已保存在本机，留空表示不修改' : '粘贴你的 API Key'}
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" loading={saving} onClick={handleSaveKey}>
              保存 Key
            </Button>
            <Button size="sm" variant="secondary" onClick={handleTest}>
              测试连接
            </Button>
          </div>
          {/* 🔴 第二段（常驻）*/}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{NOTICE_KEY}</p>

          {keyLabel && keyLabel !== '未保存' ? (
            <div className="mt-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
              <Button size="sm" variant="danger" onClick={handleDeleteKey}>
                立即删除 Key
              </Button>
              {/* 🔴 第四段（常驻）*/}
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{NOTICE_DELETE}</p>
            </div>
          ) : null}
        </div>

        {notice ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{notice}</p>
        ) : null}

        {test.kind === 'ok' ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            连接正常。
          </div>
        ) : null}

        {test.kind === 'failed' ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            连接失败：{test.message}
          </div>
        ) : null}

        <p className="text-xs text-slate-400 dark:text-slate-500">
          AI 批改由第三方模型生成，仅供参考，不代表四级官方评分。
        </p>
      </CardBody>
    </Card>
  );
}

export default AiConfigCard;