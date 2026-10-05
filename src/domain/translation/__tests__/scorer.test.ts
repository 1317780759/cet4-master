/**
 * `scorer.ts` 单测 —— 关键词 + 同义词命中、consumed 去重、档位映射、纯函数契约。
 *
 * 铁律 A8：除断言绝对值外，**必须断言不变量**
 *   （档位随 ratio 单调不减、命中区间可还原原文、points 顺序恒等于输入顺序）。
 */

import { describe, expect, it } from 'vitest';
import {
  BAND_TABLE,
  DEFAULT_SCORER_DEPS,
  KEYWORD_WEIGHT,
  OFFLINE_SCORER_LABEL,
  bandOf,
  createOfflineScorer,
  scoreOffline,
  toScore,
} from '../scorer';
import type { KeyPoint, ScoreRequest } from '../types';

function kp(id: string, head: string, extra: Partial<KeyPoint> = {}): KeyPoint {
  return { id, head, zh: `提示-${id}`, ...extra };
}

function request(text: string, keyPoints: KeyPoint[]): ScoreRequest {
  return { text, keyPoints };
}

describe('scoreOffline · 基础与边界', () => {
  it('空输入：全不命中，分母仍是满分权重', () => {
    const result = scoreOffline(request('', [kp('kp1', 'protect'), kp('kp2', 'environment')]));
    expect(result.hit).toBe(0);
    expect(result.total).toBe(2);
    expect(result.ratio).toBe(0);
    expect(result.band).toBe(0);
    expect(result.points.every((p) => p.span === null)).toBe(true);
  });

  it('空 keyPoints：防御，不得除零崩溃', () => {
    const result = scoreOffline(request('anything', []));
    expect(result).toMatchObject({ hit: 0, total: 0, ratio: 0, band: 0 });
    expect(result.points).toEqual([]);
  });

  it('运行时脏数据（undefined 字段）同样不崩', () => {
    const dirty = { text: undefined, keyPoints: undefined } as unknown as ScoreRequest;
    const result = scoreOffline(dirty);
    expect(result.total).toBe(0);
    expect(result.ratio).toBe(0);
  });

  it('★ 不变量：points 顺序恒等于 keyPoints 输入顺序（与匹配顺序无关）', () => {
    const keyPoints = [
      kp('kp1', 'development'),
      kp('kp2', 'rapid development', { weight: 2 }),
      kp('kp3', 'economy'),
    ];
    const result = scoreOffline(request('With the rapid development of the economy.', keyPoints));
    expect(result.points.map((p) => p.id)).toEqual(['kp1', 'kp2', 'kp3']);
  });

  it('★ 不变量：命中 span 必须能从用户原文还原出实际词形（matchedAs）', () => {
    const text = 'She studies hard and passed the exam.';
    const result = scoreOffline(request(text, [kp('kp1', 'study'), kp('kp2', 'pass')]));
    for (const point of result.points) {
      const [start, end] = point.span as [number, number];
      expect(text.slice(start, end)).toBe(point.matchedAs);
    }
    expect(result.points[0]?.matchedAs).toBe('studies');
    expect(result.points[1]?.matchedAs).toBe('passed');
  });
});

describe('scoreOffline · 归一化鲁棒性', () => {
  it('全大写输入照常命中', () => {
    const result = scoreOffline(request('THE ENVIRONMENT IS IMPORTANT', [kp('kp1', 'environment')]));
    expect(result.hit).toBe(1);
  });

  it('多余空格与换行照常命中（含多词词组）', () => {
    const result = scoreOffline(
      request('WITH   THE\nDEVELOPMENT   OF   ECONOMY', [kp('kp1', 'with the development of')]),
    );
    expect(result.hit).toBe(1);
  });

  it('中文标点混排：标点只作分隔符', () => {
    const result = scoreOffline(
      request('More and more people，because it is convenient。', [
        kp('kp1', 'more and more'),
        kp('kp2', 'convenient'),
      ]),
    );
    expect(result.hit).toBe(2);
  });

  it("n't 收缩展开后仍能命中 not，且不影响其它词", () => {
    const result = scoreOffline(request("It doesn't matter.", [kp('kp1', 'not'), kp('kp2', 'matter')]));
    expect(result.hit).toBe(2);
    expect(result.points[0]?.matchedAs).toBe("doesn't");
  });

  it('复数与时态词形还原命中', () => {
    const result = scoreOffline(
      request('She studies hard and passed the exams.', [
        kp('kp1', 'study'),
        kp('kp2', 'pass'),
        kp('kp3', 'exam'),
      ]),
    );
    expect(result.hit).toBe(3);
  });

  it('★ 过度还原防线：running 命中 run，但绝不命中 rune', () => {
    expect(scoreOffline(request('Running is fun.', [kp('kp1', 'run')])).hit).toBe(1);
    expect(scoreOffline(request('Running is fun.', [kp('kp1', 'rune')])).hit).toBe(0);
  });
});

describe('scoreOffline · consumed 与竞争', () => {
  it('★ 同一词重复两次只算一次命中', () => {
    const result = scoreOffline(
      request('Education is important, important, and important.', [
        kp('kp1', 'important'),
        kp('kp2', 'education'),
      ]),
    );
    expect(result.hit).toBe(2);
    expect(result.total).toBe(2);
  });

  it('★ consumed：单词得分点不得复用已被多词词组占用的 token', () => {
    const result = scoreOffline(
      request('With the rapid development of the economy.', [
        kp('kp1', 'development'),
        kp('kp2', 'rapid development', { weight: 2 }),
      ]),
    );
    // 多词优先 → kp2 命中并占用 development；kp1 因此不命中（不是"两个都算"）
    const byId = new Map(result.points.map((p) => [p.id, p.hit]));
    expect(byId.get('kp2')).toBe(true);
    expect(byId.get('kp1')).toBe(false);
    expect(result.hit).toBe(1);
  });

  it('★ 多词词组优先于单词：长词组不会被组成词先吃掉', () => {
    const result = scoreOffline(
      request('Education plays an important role in economic development.', [
        kp('kp1', 'role'),
        kp('kp2', 'play an important role in', { weight: 2 }),
      ]),
    );
    const byId = new Map(result.points.map((p) => [p.id, p.hit]));
    expect(byId.get('kp2')).toBe(true);
    expect(byId.get('kp1')).toBe(false);
  });

  it('同一个词出现两次可分别满足两个不同的多词词组', () => {
    const result = scoreOffline(
      request('With the development of economy, we can see rapid development in technology.', [
        kp('kp1', 'with the development of'),
        kp('kp2', 'rapid development'),
      ]),
    );
    expect(result.hit).toBe(2);
  });
});

describe('scoreOffline · 同义词与权重', () => {
  it('同义词命中（preserve → protect）', () => {
    const result = scoreOffline(
      request('We should preserve the environment.', [
        kp('kp1', 'protect', { synonyms: ['preserve', 'safeguard'] }),
      ]),
    );
    expect(result.hit).toBe(1);
    expect(result.points[0]?.matchedAs).toBe('preserve');
  });

  it('同义词本身不是 head 时，matchedAs 仍是用户原文词形', () => {
    const result = scoreOffline(request('Governments safeguard it.', [kp('kp1', 'protect', { synonyms: ['safeguard'] })]));
    expect(result.points[0]?.matchedAs).toBe('safeguard');
  });

  it('权重参与分子与分母：命中权重 2、漏掉权重 1 → 2/3', () => {
    const result = scoreOffline(
      request('Protect the air.', [kp('kp1', 'protect', { weight: 2 }), kp('kp2', 'environment')]),
    );
    expect(result.ratio).toBeCloseTo(2 / 3, 4);
  });

  it('optional 未命中按 0.5 权重计入分母：1 / 1.5 ≈ 0.6667', () => {
    const result = scoreOffline(
      request('Protect the air.', [kp('kp1', 'protect'), kp('kp2', 'government', { optional: true })]),
    );
    expect(result.ratio).toBeCloseTo(1 / (1 + KEYWORD_WEIGHT.optionalMissFactor), 4);
  });

  it('optional 命中时按满权重计入分子与分母 → 满分', () => {
    const result = scoreOffline(
      request('The government protects it.', [
        kp('kp1', 'protect'),
        kp('kp2', 'government', { optional: true }),
      ]),
    );
    expect(result.ratio).toBe(1);
    expect(result.hit).toBe(2);
  });

  it('weight 缺省回落到 KEYWORD_WEIGHT.default', () => {
    const result = scoreOffline(request('Protect it.', [kp('kp1', 'protect'), kp('kp2', 'air')]));
    expect(result.ratio).toBeCloseTo(KEYWORD_WEIGHT.default / (KEYWORD_WEIGHT.default * 2), 4);
  });

  it('非法 weight（NaN）回落默认值，不污染计算', () => {
    const result = scoreOffline(request('Protect it.', [kp('kp1', 'protect', { weight: Number.NaN })]));
    expect(result.ratio).toBe(1);
  });
});

describe('bandOf / BAND_TABLE', () => {
  it('★ 不变量：BAND_TABLE 的 minRatio 严格递减，且首条覆盖满分', () => {
    expect(BAND_TABLE[0]?.minRatio).toBeLessThanOrEqual(1);
    for (let i = 1; i < BAND_TABLE.length; i += 1) {
      expect((BAND_TABLE[i] as { minRatio: number }).minRatio).toBeLessThan(
        (BAND_TABLE[i - 1] as { minRatio: number }).minRatio,
      );
    }
  });

  it('★ 不变量：ratio 升高时 band 单调不减（铁律 A8 的"关系"断言）', () => {
    let previous = 0;
    for (let ratio = 0; ratio <= 1.0001; ratio += 0.01) {
      const band = bandOf(Math.min(ratio, 1));
      expect(band).toBeGreaterThanOrEqual(previous);
      previous = band;
    }
  });

  it('异常 ratio（负数 / NaN）不崩，回落到 0 档', () => {
    expect(bandOf(-1)).toBe(0);
    expect(bandOf(Number.NaN)).toBe(0);
  });

  it('边界值落在文档规定的档位上（含端点）', () => {
    expect(bandOf(1)).toBe(4);
    expect(bandOf(0.95)).toBe(4);
    expect(bandOf(0.9499)).toBe(3);
    expect(bandOf(0.8)).toBe(3);
    expect(bandOf(0.7999)).toBe(2);
    expect(bandOf(0.6)).toBe(2);
    expect(bandOf(0.5999)).toBe(1);
    expect(bandOf(0.4)).toBe(1);
    expect(bandOf(0.3999)).toBe(0);
    expect(bandOf(0)).toBe(0);
  });
});

describe('scoreOffline · 纯函数契约', () => {
  const keyPoints = [kp('kp1', 'protect'), kp('kp2', 'environment', { optional: true })];

  it('同输入恒等输出（可重复调用）', () => {
    const req = request('We should protect the environment.', keyPoints);
    expect(scoreOffline(req)).toEqual(scoreOffline(req));
  });

  it('deps 由外部注入，注入不同随机源不影响离线结果', () => {
    const req = request('We should protect the environment.', keyPoints);
    const a = scoreOffline(req, { now: 0, random: () => 0 });
    const b = scoreOffline(req, { now: 1_700_000_000_000, random: () => 0.99 });
    expect(a).toEqual(b);
  });

  it('缺省 deps 时回落到 DEFAULT_SCORER_DEPS（固定值，非 Date.now）', () => {
    expect(DEFAULT_SCORER_DEPS.now).toBe(0);
    expect(typeof DEFAULT_SCORER_DEPS.random).toBe('function');
    expect(DEFAULT_SCORER_DEPS.random()).toBe(0);
  });

  it('非法 deps 抛 TypeError，守住"不得裸用 Date.now / Math.random"的纪律', () => {
    const req = request('x', keyPoints);
    expect(() => scoreOffline(req, { now: Number.NaN })).toThrow(TypeError);
    expect(() =>
      scoreOffline(req, { random: undefined as unknown as () => number }),
    ).toThrow(TypeError);
  });

  it('scoredBy 恒为离线标签，便于 UI 显示评分来源', () => {
    expect(scoreOffline(request('x', keyPoints)).scoredBy).toBe(OFFLINE_SCORER_LABEL);
  });
});

describe('createOfflineScorer', () => {
  it('实现 TranslationScorer 契约：id / label / 异步 score', async () => {
    const scorer = createOfflineScorer();
    expect(scorer.id).toBe('offline');
    expect(scorer.label).toBe(OFFLINE_SCORER_LABEL);
    const result = await scorer.score(request('We should protect the environment.', [kp('kp1', 'protect')]));
    expect(result.hit).toBe(1);
    expect(result.scoredBy).toBe(OFFLINE_SCORER_LABEL);
  });

  it('可注入 deps 且结果一致', async () => {
    const scorer = createOfflineScorer({ now: 123, random: () => 0.5 });
    const result = await scorer.score(request('protect', [kp('kp1', 'protect')]));
    expect(result.band).toBe(4);
  });
});

describe('toScore', () => {
  it('压成落库快照，字段与 ScoreResult 一致', () => {
    const result = scoreOffline(request('We should protect the environment.', [kp('kp1', 'protect'), kp('kp2', 'air')]));
    const score = toScore(result);
    expect(score).toEqual({
      hit: result.hit,
      total: result.total,
      ratio: result.ratio,
      band: result.band,
      scoredBy: result.scoredBy,
    });
    expect(Object.keys(score)).not.toContain('points');
  });
});
