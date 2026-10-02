import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDb } from '@/app/providers/DbProvider';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useStatsStore } from '@/store/useStatsStore';
import { Button, Card, CardBody, CardHeader, CardTitle, Progress } from '@/ui/primitives';
import { DonutChart, DonutLegend, HeatmapCalendar, HeatmapLegend, LineChart, LineLegend } from '@/ui/charts';

/** 掌握度分布配色（纯 SVG，无图表库）—— 低饱和土系，避开默认的荧光绿/亮蓝 */
const MASTERY_COLORS = {
  new: '#a89d89',
  learning: '#bd8f33',
  young: '#4a6b8a',
  mature: '#57753e',
} as const;

/** 趋势线配色：复习用青灰蓝，新学用朱红 */
const TREND_COLORS = {
  review: '#4a6b8a',
  fresh: '#ad4324',
} as const;

/**
 * 首页 —— M1 版：今日进度 / 连续打卡 / 掌握度分布 / 30 日趋势 / 年度热力图 / 高频词覆盖率。
 * 数据全部来自本机 IndexedDB，无任何网络请求。
 */
export default function DashboardPage(): ReactNode {
  const instance = useDb();
  const navigate = useNavigate();
  const data = useStatsStore((s) => s.data);
  const loading = useStatsStore((s) => s.loading);
  const error = useStatsStore((s) => s.error);
  const load = useStatsStore((s) => s.load);

  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const dailyGoal = useSettingsStore((s) => s.settings.dailyGoal);

  useEffect(() => {
    void (async (): Promise<void> => {
      await hydrateSettings();
      await load(instance);
    })();
  }, [hydrateSettings, load, instance]);

  const donutSegments = useMemo(() => {
    if (!data) return [];
    return [
      { label: '未学/新词', value: data.mastery.new, color: MASTERY_COLORS.new },
      { label: '学习中', value: data.mastery.learning, color: MASTERY_COLORS.learning },
      { label: '短期记忆', value: data.mastery.young, color: MASTERY_COLORS.young },
      { label: '长期记忆', value: data.mastery.mature, color: MASTERY_COLORS.mature },
    ];
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>统计加载失败</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p>{error}</p>
            <Button onClick={(): void => void load(instance)}>重试</Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        {loading ? '正在统计…' : '暂无数据'}
      </div>
    );
  }

  const goalPct = data.today.goalRatio;
  const accuracy = Math.round(data.today.accuracy * 100);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* 页头：标题走衬线，"连续天数"降级为小字，不再靠 emoji 撑视觉 */}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl text-slate-900 dark:text-slate-50">今日</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          连续 <span className="tabular font-medium text-slate-800 dark:text-slate-100">{data.streak}</span> 天
        </span>
      </div>

      {/* —— 今日进度 —— */}
      <Card>
        <CardHeader>
          <CardTitle>今日进度</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">目标 {dailyGoal} 个新词</span>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* 三个数字用细线分隔做成"记账本"的一行，比塞进一行小字清楚得多 */}
          <div className="flex items-stretch divide-x divide-slate-200 dark:divide-slate-800">
            <Stat label="新学" value={data.today.newLearned} unit={`/${dailyGoal}`} />
            <Stat label="复习" value={data.today.reviewed} />
            <Stat label="正确率" value={accuracy} unit="%" />
          </div>

          <Progress value={goalPct} label="每日新词目标" />

          <div className="flex gap-2">
            <Button block onClick={(): void => { void navigate('/learn'); }}>
              继续背词
            </Button>
            <Button
              block
              variant="secondary"
              onClick={(): void => { void navigate('/review'); }}
              disabled={data.dueCount === 0}
            >
              复习{data.dueCount > 0 ? `（${data.dueCount}）` : ''}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button block variant="secondary" onClick={(): void => { void navigate('/quiz'); }}>
              四选一测验
            </Button>
            <Button block variant="secondary" onClick={(): void => { void navigate('/books'); }}>
              词本
            </Button>
            <Button block variant="secondary" onClick={(): void => { void navigate('/settings'); }}>
              设置
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* —— 真题（低频长时操作，不占一级 Tab）—— */}
      <Card>
        <CardHeader>
          <CardTitle>真题</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">练习模式</span>
        </CardHeader>
        <CardBody className="flex gap-2">
          <Button block variant="secondary" onClick={(): void => { void navigate('/papers'); }}>
            套卷
          </Button>
          <Button block variant="secondary" onClick={(): void => { void navigate('/mock'); }}>
            真题练习
          </Button>
        </CardBody>
      </Card>

      {/* —— 掌握度分布 —— */}
      <Card>
        <CardHeader>
          <CardTitle>掌握度分布</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">共 {data.masteryTotal} 张卡片</span>
        </CardHeader>
        <CardBody>
          {data.masteryTotal === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              还没有学习记录 —— 点「继续背词」开始第一组吧。
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <DonutChart
                segments={donutSegments}
                centerValue={`${data.mastery.mature + data.mastery.young}`}
                centerTitle="已入长期/短期记忆"
              />
              <DonutLegend segments={donutSegments} className="w-full sm:w-48" />
            </div>
          )}
        </CardBody>
      </Card>

      {/* —— 30 日趋势 —— */}
      <Card>
        <CardHeader>
          <CardTitle>近 30 天</CardTitle>
          <LineLegend
            series={[
              { label: '复习', color: TREND_COLORS.review },
              { label: '新学', color: TREND_COLORS.fresh },
            ]}
          />
        </CardHeader>
        <CardBody>
          <LineChart
            series={[
              { label: '复习', color: TREND_COLORS.review, values: data.trend30.map((p) => p.reviewed) },
              { label: '新学', color: TREND_COLORS.fresh, values: data.trend30.map((p) => p.newLearned) },
            ]}
            labels={data.trend30.map((p) => p.date.slice(5))}
            height={180}
          />
        </CardBody>
      </Card>

      {/* —— 年度热力图 —— */}
      <Card>
        <CardHeader>
          <CardTitle>学习打卡</CardTitle>
          <HeatmapLegend />
        </CardHeader>
        <CardBody>
          <HeatmapCalendar grid={data.heatmap} />
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            近半年共学习 {data.heatmap.total} 次 · 单日峰值 {data.heatmap.max} 次 · 历史最长连续{' '}
            {data.longest} 天
          </p>
        </CardBody>
      </Card>

      {/* —— 高频词覆盖率（G1）—— */}
      <Card>
        <CardHeader>
          <CardTitle>高频词覆盖率（Top 2104）</CardTitle>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {data.coverage.coreLearned} / {data.coverage.coreTotal}
          </span>
        </CardHeader>
        <CardBody className="space-y-2">
          <Progress value={data.coverage.ratio} label="高频词覆盖率" />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            已引入 {data.coverage.learned} 个词 · 词库共 {data.wordCount} 条 · 已掌握（移出队列）{data.suspended} 个
          </p>
        </CardBody>
      </Card>

      <p className="pb-4 text-xs text-slate-400 dark:text-slate-500">
        词库来自 exam-data/CETVocabulary（CC BY-NC-SA 4.0，非商用）。本站点为个人学习用途，
        数据全部保存在本机浏览器，无账号、无后端、无上传。
      </p>
    </div>
  );
}

/** 单个统计格：数字用衬线 + 等宽，单位小一号 */
function Stat({ label, value, unit }: { label: string; value: number; unit?: string }): ReactNode {
  return (
    <div className="flex-1 px-1 text-center first:pl-0 last:pr-0">
      <div className="font-display text-2xl leading-none text-slate-900 tabular dark:text-slate-50">
        {value}
        {unit ? <span className="text-sm font-sans font-normal text-slate-500">{unit}</span> : null}
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
