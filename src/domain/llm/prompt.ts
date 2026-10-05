/**
 * AI 批改提示词构建（纯函数，零 IO —— 铁律 A1）。
 *
 * 设计来源：`docs/04b-优化项技术设计.md` §5.14.5（提示词设计）。
 *
 * ★ 这里的字符串是**逐字照抄文档**的，任何改动都必须先改文档再改代码，
 *   因为 UI 的免责声明与模型的输出格式都依赖这些措辞（尤其是"你不是官方阅卷方"）。
 */

/** system prompt：四级翻译阅卷助手（15 分制六档 + 严格 JSON 输出要求） */
const SYSTEM_PROMPT = `你是一名大学英语四级（CET-4）翻译阅卷助手。请按四级翻译的评分标准（满分 15 分）批改用户的汉译英。

评分档位（15 分制）：
- 14-15 分：译文准确表达了原文的意思，用词贴切，行文流畅，基本上无语言错误，仅有个别小错。
- 11-13 分：译文基本表达了原文的意思，文字通顺，但有少量语言错误。
- 8-10 分：译文勉强表达了原文的意思，语言错误相当多。
- 5-7 分：译文仅表达了一小部分原文的意思，有较多严重语言错误。
- 2-4 分：译文支离破碎，仅有个别句子正确。
- 0-1 分：未作答，或只有几个孤立的词。

严格要求：
1. 只输出一个 JSON 对象，不要输出任何解释，不要使用 Markdown 代码块。
2. score 为 0-15 的整数；band 取 0-4，对应 待加强 / 及格 / 良好 / 优秀，其中 14-15 分为 4。
3. corrections 逐条给出：original（用户原句）、suggested（你的修改建议）、
   type（从 grammar / spelling / word-choice / missing-info / word-order /
   punctuation / capitalization 中选一个）、note（一句话中文说明）。
4. 正确的句子不要放进 corrections。corrections 最多 5 条，按严重程度排序。
5. 不得编造用户没有写过的内容；不得输出与本次翻译无关的背景知识。
6. 你不是官方阅卷方，评分仅供练习参考。`;

/** user prompt 的四段标题（逐字来自 §5.14.5 模板） */
const SECTION_ORIGINAL = '【中文原文】';
const SECTION_REFERENCE = '【参考译文（仅供你理解考点，不是唯一标准答案）】';
const SECTION_KEY_POINTS = '【本题得分点】';
const SECTION_MY_TEXT = '【用户译文】';

/** user prompt 的收尾指令 */
const OUTPUT_INSTRUCTION = '请按系统要求输出 JSON。';

/** 得分点条目在 prompt 里的形状（只需 head 与中文提示，不传 id / 权重等内部字段） */
export interface PromptKeyPoint {
  /** 必须命中的英文词/词组 */
  head: string;
  /** 对应中文提示 */
  zh: string;
}

/** `buildUserPrompt()` 的入参 */
export interface UserPromptInput {
  /** 中文题干 */
  zh: string;
  /** 参考译文（教学用途自撰） */
  reference: string;
  /** 我的译文 */
  myText: string;
  /** 本题得分点 */
  keyPoints: readonly PromptKeyPoint[];
}

/**
 * 返回 system prompt 原文。
 *
 * ★ 纯函数：无参数、无随机、无 IO，同输入恒等输出，便于做快照测试。
 */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * 渲染得分点为一行一条的文本：`head（zh）`。
 *
 * 空数组时给一个占位，避免模型因为"本节为空"而自由发挥。
 */
export function renderKeyPoints(keyPoints: readonly PromptKeyPoint[]): string {
  if (keyPoints.length === 0) return '（本题未标注得分点）';
  return keyPoints.map((point) => `${point.head}（${point.zh}）`).join('\n');
}

/**
 * 构建 user prompt（四段式：中文原文 / 参考译文 / 得分点 / 我的译文）。
 *
 * ★ 纯函数：不做任何 trim / 转义之外的加工，用户原文怎么输入就怎么送出去
 *   （由 model 侧自行判断，绝不在这里"帮忙改译文"）。
 */
export function buildUserPrompt(input: UserPromptInput): string {
  return [
    `${SECTION_ORIGINAL}\n${input.zh}`,
    `${SECTION_REFERENCE}\n${input.reference}`,
    `${SECTION_KEY_POINTS}\n${renderKeyPoints(input.keyPoints)}`,
    `${SECTION_MY_TEXT}\n${input.myText}`,
    OUTPUT_INSTRUCTION,
  ].join('\n\n');
}
