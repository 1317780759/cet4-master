import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDb } from '@/app/providers/DbProvider';
import { useThemeOptional, type ThemeMode } from '@/app/providers/ThemeProvider';
import { exportProgressJson, importProgressJson, type ImportReport } from '@/services/backup/exportImport';
import { CORE_BOUNDARY, CET4_BOUNDARY } from '@/domain/word/tier';
import type { TierFilter } from '@/domain/settings/types';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Segmented, Switch } from '@/ui/primitives';

/**
 * 设置页 —— 让「学习计划」真正可调。
 *
 * ★ 为什么必须有这一页：`UserSettings` 里的 dailyGoal / tier / peekPenalty 等
 *   直接决定每天学多少、学哪些词、偷看是否扣分，但此前**没有任何 UI 能改它们** ——
 *   能力实现了却不可达，等于没有。持久化一律走 settingsRepo（与导入导出同一份数据）。
 */

type Accent = 'uk' | 'us';
type TtsProvider = 'youdao' | 'webspeech' | 'off';

const TIER_OPTIONS: Array<{ value: TierFilter; label: string }> = [
  { value: 'core2104', label: `高频核心 ${CORE_BOUNDARY}` },
  { value: 'cet4', label: `四级考纲 ${CET4_BOUNDARY}` },
  { value: 'extended', label: '扩展' },
  { value: 'all', label: '全部' },
];

const GOAL_PRESETS = [10, 20, 30, 50] as const;

export default function SettingsPage(): ReactNode {
  const instance = useDb();
  const settings = useSettingsStore((s) => s.settings);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  // ★ 用可选版本：设置页"顺带"管主题，不该因为缺 Provider 就整页崩掉
  const theme = useThemeOptional();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback((): void => {
    void (async (): Promise<void> => {
      setBusy(true);
      setBackupError(null);
      try {
        const text = await exportProgressJson(instance);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cet4-progress-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        setBackupError(error instanceof Error ? error.message : '导出失败');
      } finally {
        setBusy(false);
      }
    })();
  }, [instance]);

  const handleImport = useCallback(
    (file: File): void => {
      void (async (): Promise<void> => {
        setBusy(true);
        setBackupError(null);
        setReport(null);
        try {
          const text = await file.text();
          // ★ 默认 merge：只补本地缺失的进度，绝不覆盖既有学习记录。
          //   replace 会清空本地，必须由用户在下方二次确认后单独触发。
          const result = await importProgressJson(text, { mode: 'merge', instance });
          setReport(result);
        } catch (error) {
          setBackupError(error instanceof Error ? error.message : '导入失败（可能不是本站导出的备份）');
        } finally {
          setBusy(false);
          if (fileRef.current) fileRef.current.value = '';
        }
      })();
    },
    [instance],
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-16">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">设置</h1>

      {/* —— 学习计划 —— */}
      <Card>
        <CardHeader>
          <CardTitle>学习计划</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">决定每天学多少</span>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                每日新词量
              </span>
              <Badge tone="info">{settings.dailyGoal} 个</Badge>
            </div>
            <Segmented
              ariaLabel="每日新词量"
              block
              options={GOAL_PRESETS.map((n) => ({ value: String(n), label: `${n}` }))}
              value={String(settings.dailyGoal)}
              onChange={(v): void => void update({ dailyGoal: Number(v) })}
            />
            <NumberField
              label="自定义新词量"
              value={settings.dailyGoal}
              min={5}
              max={200}
              step={5}
              onChange={(v): void => void update({ dailyGoal: v })}
            />
          </div>

          <NumberField
            label="每日复习上限"
            hint="防止某天积压雪崩；到上限后当天不再加新复习"
            value={settings.reviewLimit}
            min={20}
            max={1000}
            step={20}
            onChange={(v): void => void update({ reviewLimit: v })}
          />

          <div>
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              词频档位
            </div>
            <Segmented
              ariaLabel="词频档位"
              block
              size="sm"
              options={TIER_OPTIONS}
              value={settings.tier}
              onChange={(v): void => void update({ tier: v })}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              档位越窄，背到的词越可能是考试里真正会出现的词。
            </p>
          </div>
        </CardBody>
      </Card>

      {/* —— 发音 —— */}
      <Card>
        <CardHeader>
          <CardTitle>发音</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Switch
            label="自动发音"
            description="翻到新词时自动朗读（浏览器要求先有一次点击才会允许出声）"
            checked={settings.autoPlay}
            onChange={(v): void => void update({ autoPlay: v })}
          />
          <div>
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">口音</div>
            <Segmented
              ariaLabel="口音"
              options={[
                { value: 'us', label: '美音' },
                { value: 'uk', label: '英音' },
              ]}
              value={settings.accent}
              onChange={(v): void => void update({ accent: v as Accent })}
            />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              发音来源
            </div>
            <Segmented
              ariaLabel="发音来源"
              size="sm"
              block
              options={[
                { value: 'webspeech', label: '系统合成' },
                { value: 'youdao', label: '有道' },
                { value: 'off', label: '关闭' },
              ]}
              value={settings.ttsProvider}
              onChange={(v): void => void update({ ttsProvider: v as TtsProvider })}
            />
          </div>
        </CardBody>
      </Card>

      {/* —— 学习行为 —— */}
      <Card>
        <CardHeader>
          <CardTitle>学习行为</CardTitle>
        </CardHeader>
        <CardBody className="divide-y divide-slate-100 dark:divide-slate-800">
          <Switch
            label="偷看扣分"
            description="先看了释义再自评，本次按更保守的间隔计算，避免自欺欺人"
            checked={settings.peekPenalty}
            onChange={(v): void => void update({ peekPenalty: v })}
          />
          <Switch
            label="按词频顺序出词"
            description="关闭则随机出词；开启时始终先学更高频的词"
            checked={settings.freqOrdering}
            onChange={(v): void => void update({ freqOrdering: v })}
          />
          <Switch
            label="后台预取词库分片"
            description="提前下载后续分片，之后断网也能继续背"
            checked={settings.prefetchEnabled}
            onChange={(v): void => void update({ prefetchEnabled: v })}
          />
        </CardBody>
      </Card>

      {/* —— 外观 —— */}
      <Card>
        <CardHeader>
          <CardTitle>外观</CardTitle>
        </CardHeader>
        <CardBody>
          {/* ★ 主题有两处状态：ThemeProvider 负责真正上色（并写 localStorage），
              settings.theme 负责随备份导出。两者在这里同时更新，避免"改了设置但没变色"。 */}
          <Segmented
            ariaLabel="主题"
            block
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ]}
            value={settings.theme}
            onChange={(v): void => {
              theme?.setMode(v as ThemeMode);
              void update({ theme: v as ThemeMode });
            }}
          />
          {theme === null ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              主题控制器未挂载，本次只能记录偏好、不能立即切换外观。
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* —— 数据 —— */}
      <Card>
        <CardHeader>
          <CardTitle>数据</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">全部存在本机</span>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <Button block variant="secondary" loading={busy} onClick={handleExport}>
              导出备份
            </Button>
            <Button block variant="secondary" disabled={busy} onClick={(): void => fileRef.current?.click()}>
              导入备份
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e): void => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            导入默认「合并」——只补本地没有的记录，不会覆盖已有进度。备份文件只在你自己的设备上流转。
          </p>
          {report ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              导入完成：写入 {Object.values(report.imported).reduce((a, b) => a + b, 0)} 条，
              跳过重复 {report.skipped} 条。
            </div>
          ) : null}
          {backupError ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
              {backupError}
            </div>
          ) : null}
          <Button block variant="ghost" onClick={(): void => void reset()}>
            恢复默认设置
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

/** 数字字段：带步进按钮，避免手写 input 产生非法值 */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}): ReactNode {
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${label} 减少`}
            onClick={(): void => onChange(clamp(value - step))}
          >
            −
          </Button>
          <span className="w-14 text-center text-sm tabular-nums text-slate-900 dark:text-slate-50">
            {value}
          </span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${label} 增加`}
            onClick={(): void => onChange(clamp(value + step))}
          >
            +
          </Button>
        </div>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}
