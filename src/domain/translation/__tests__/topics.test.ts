/**
 * `topics.ts` 单测 —— 15 个四级常考话题常量。
 *
 * 铁律 A8：断言**关系**而非魔法数字（key 唯一、与标签表一一对应、覆盖设计文档 §5.10.2）。
 */

import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_TOPICS,
  TRANSLATION_TOPIC_COUNT,
  TRANSLATION_TOPIC_KEYS,
  TRANSLATION_TOPIC_LABEL,
  isTranslationTopicKey,
  translationTopicLabel,
} from '../topics';

describe('TRANSLATION_TOPICS', () => {
  it('★ 不变量：恰好 15 个话题，key 唯一且非空标签', () => {
    expect(TRANSLATION_TOPIC_COUNT).toBe(15);
    expect(TRANSLATION_TOPICS).toHaveLength(15);
    expect(new Set(TRANSLATION_TOPIC_KEYS).size).toBe(15);
    for (const topic of TRANSLATION_TOPICS) {
      expect(topic.key.length).toBeGreaterThan(0);
      expect(topic.label.length).toBeGreaterThan(0);
    }
  });

  it('★ 不变量：KEYS / LABEL / TOPICS 三者一一对应', () => {
    expect(Object.keys(TRANSLATION_TOPIC_LABEL).sort()).toEqual([...TRANSLATION_TOPIC_KEYS].sort());
    for (const topic of TRANSLATION_TOPICS) {
      expect(TRANSLATION_TOPIC_LABEL[topic.key]).toBe(topic.label);
    }
  });

  it('覆盖设计文档 §5.10.2 列出的全部 key 与标签', () => {
    const expected: Record<string, string> = {
      'trad-culture': '传统文化',
      festival: '节日习俗',
      food: '饮食文化',
      economy: '经济发展',
      tech: '科技成就',
      health: '健康医疗',
      travel: '旅游观光',
      education: '教育考试',
      environment: '环境保护',
      urbanisation: '城市化',
      transport: '交通出行',
      internet: '互联网',
      employment: '就业创业',
      aging: '人口老龄化',
      sports: '体育运动',
    };
    expect({ ...TRANSLATION_TOPIC_LABEL }).toEqual(expected);
  });
});

describe('isTranslationTopicKey', () => {
  it('合法 key 返回 true', () => {
    for (const key of TRANSLATION_TOPIC_KEYS) {
      expect(isTranslationTopicKey(key)).toBe(true);
    }
  });

  it('非法 key 返回 false', () => {
    expect(isTranslationTopicKey('')).toBe(false);
    expect(isTranslationTopicKey('tradition-culture')).toBe(false);
    expect(isTranslationTopicKey('TRAD-CULTURE')).toBe(false);
    expect(isTranslationTopicKey('mixed')).toBe(false);
  });
});

describe('translationTopicLabel', () => {
  it('合法 key 返回中文标签', () => {
    expect(translationTopicLabel('trad-culture')).toBe('传统文化');
    expect(translationTopicLabel('sports')).toBe('体育运动');
  });

  it('★ 未知 key 降级为「综合」而不是抛错（话题只是展示属性）', () => {
    expect(translationTopicLabel('mixed')).toBe('综合');
    expect(translationTopicLabel('')).toBe('综合');
  });
});
