/**
 * `prompt.ts` 单测 —— 提示词快照（防止有人"顺手改措辞"却忘了同步文档）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.5。
 * ★ §5.14.9 / §5.14.5 的措辞是产品承诺：免责声明与输出格式都挂在这些字符串上，
 *   所以这里断言的是**原文片段**，而不是"长度 > 0"这种空洞断言。
 */

import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserPrompt, renderKeyPoints } from '../prompt';

const SYSTEM = buildSystemPrompt();

describe('buildSystemPrompt', () => {
  it('★ 含免责声明原文「你不是官方阅卷方，评分仅供练习参考。」', () => {
    expect(SYSTEM).toContain('你不是官方阅卷方，评分仅供练习参考。');
  });

  it('含 15 分制说明与六档档位表（逐档断言）', () => {
    expect(SYSTEM).toContain('满分 15 分');
    expect(SYSTEM).toContain('评分档位（15 分制）：');
    expect(SYSTEM).toContain('- 14-15 分：译文准确表达了原文的意思，用词贴切，行文流畅，基本上无语言错误，仅有个别小错。');
    expect(SYSTEM).toContain('- 11-13 分：译文基本表达了原文的意思，文字通顺，但有少量语言错误。');
    expect(SYSTEM).toContain('- 8-10 分：译文勉强表达了原文的意思，语言错误相当多。');
    expect(SYSTEM).toContain('- 5-7 分：译文仅表达了一小部分原文的意思，有较多严重语言错误。');
    expect(SYSTEM).toContain('- 2-4 分：译文支离破碎，仅有个别句子正确。');
    expect(SYSTEM).toContain('- 0-1 分：未作答，或只有几个孤立的词。');
  });

  it('含"只输出 JSON、不要用 Markdown 代码块"的硬要求', () => {
    expect(SYSTEM).toContain('只输出一个 JSON 对象');
    expect(SYSTEM).toContain('不要使用 Markdown 代码块');
  });

  it('含 score / band / corrections 的格式约定与 7 种 type 白名单', () => {
    expect(SYSTEM).toContain('score 为 0-15 的整数');
    expect(SYSTEM).toContain('band 取 0-4');
    expect(SYSTEM).toContain('corrections 最多 5 条');
    for (const type of [
      'grammar',
      'spelling',
      'word-choice',
      'missing-info',
      'word-order',
      'punctuation',
      'capitalization',
    ]) {
      expect(SYSTEM).toContain(type);
    }
  });

  it('纯函数：无参数、无副作用，重复调用恒等', () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
  });
});

describe('buildUserPrompt', () => {
  const input = {
    zh: '随着经济的发展，越来越多的人选择出国旅游。',
    reference: 'With the development of the economy, more and more people choose to travel abroad.',
    myText: 'With the economic develop, more and more people choose travel abroad.',
    keyPoints: [
      { head: 'with the development of', zh: '随着……的发展' },
      { head: 'more and more', zh: '越来越多的' },
      { head: 'choose to travel abroad', zh: '选择出国旅游' },
    ],
  };

  it('★ 含中文原文 / 参考译文 / 我的译文三段原文（逐字）', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('【中文原文】');
    expect(prompt).toContain(input.zh);
    expect(prompt).toContain('【参考译文（仅供你理解考点，不是唯一标准答案）】');
    expect(prompt).toContain(input.reference);
    expect(prompt).toContain('【用户译文】');
    expect(prompt).toContain(input.myText);
  });

  it('★ 四段顺序固定：原文 → 参考译文 → 得分点 → 用户译文 → 输出指令', () => {
    const prompt = buildUserPrompt(input);
    const order = [
      prompt.indexOf('【中文原文】'),
      prompt.indexOf('【参考译文'),
      prompt.indexOf('【本题得分点】'),
      prompt.indexOf('【用户译文】'),
      prompt.indexOf('请按系统要求输出 JSON。'),
    ];
    for (const index of order) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it('得分点渲染为一行一条的 head（zh）', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('with the development of（随着……的发展）');
    expect(prompt).toContain('more and more（越来越多的）');
    expect(prompt).toContain('choose to travel abroad（选择出国旅游）');
  });

  it('空得分点给占位文案，不会出现空段', () => {
    const prompt = buildUserPrompt({ ...input, keyPoints: [] });
    expect(prompt).toContain('（本题未标注得分点）');
  });

  it('纯函数：同输入恒等输出，且不修改入参', () => {
    const a = buildUserPrompt(input);
    const b = buildUserPrompt(input);
    expect(a).toBe(b);
    expect(input.keyPoints).toHaveLength(3);
  });
});

describe('renderKeyPoints', () => {
  it('一条一行，用中文全角括号包裹提示', () => {
    expect(renderKeyPoints([{ head: 'protect', zh: '保护' }, { head: 'environment', zh: '环境' }])).toBe(
      'protect（保护）\nenvironment（环境）',
    );
  });

  it('空数组 → 占位文案', () => {
    expect(renderKeyPoints([])).toBe('（本题未标注得分点）');
  });
});
