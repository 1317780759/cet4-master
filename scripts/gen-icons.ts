/**
 * scripts/gen-icons.ts —— 生成 PWA 图标（纯代码，不引入任何图像库 / 不下载素材）。
 *
 * ★ 为什么要自己画：仓库禁止大二进制、也不该为了几个图标引入依赖；
 *   而且图标必须**可重新生成**（换品牌色时跑一次即可），手写 PNG 编码器反而最省事。
 *
 * 运行：pnpm icons
 */

import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT_DIR, ensureDir } from './lib/pipeline';

/** 品牌色 #2563eb（与 index.html 的 theme-color 保持一致） */
const BRAND: readonly [number, number, number] = [0x25, 0x63, 0xeb];
const WHITE: readonly [number, number, number] = [0xff, 0xff, 0xff];

/** 5×7 位图字体 —— 只定义图标要用的两个字符，够用即可 */
const GLYPHS: Record<string, readonly string[]> = {
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  '4': ['00110', '01010', '10010', '11111', '00010', '00010', '00010'],
};

const TEXT = ['C', '4'];
const UNIT_W = TEXT.length * 5 + (TEXT.length - 1); // 字宽 5 + 字间距 1
const UNIT_H = 7;

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 写一张 RGBA PNG（color type 6，逐行 filter 0） */
function encodePng(size: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 画图标：品牌色底 + 白色 "C4"。
 * 用 4× 超采样再降采样，避免大尺寸下出现锯齿硬边。
 */
export function drawIcon(size: number): Buffer {
  const ss = 4;
  const big = size * ss;
  const mask = new Uint8Array(big * big); // 1 = 前景（白）

  const scale = Math.max(1, Math.floor((big * 0.56) / UNIT_W));
  const startX = Math.floor((big - UNIT_W * scale) / 2);
  const startY = Math.floor((big - UNIT_H * scale) / 2);

  TEXT.forEach((ch, gi) => {
    const rows = GLYPHS[ch]!;
    const ox = startX + gi * 6 * scale;
    for (let r = 0; r < UNIT_H; r += 1) {
      const line = rows[r]!;
      for (let c = 0; c < 5; c += 1) {
        if (line[c] !== '1') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          const y = startY + r * scale + dy;
          for (let dx = 0; dx < scale; dx += 1) {
            const x = ox + c * scale + dx;
            if (x >= 0 && x < big && y >= 0 && y < big) mask[y * big + x] = 1;
          }
        }
      }
    }
  });

  const out = Buffer.alloc(size * size * 4);
  const area = ss * ss;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        const row = (y * ss + dy) * big + x * ss;
        for (let dx = 0; dx < ss; dx += 1) sum += mask[row + dx]!;
      }
      const a = sum / area; // 0..1 覆盖率 = 抗锯齿权重
      const i = (y * size + x) * 4;
      out[i] = Math.round(BRAND[0] * (1 - a) + WHITE[0] * a);
      out[i + 1] = Math.round(BRAND[1] * (1 - a) + WHITE[1] * a);
      out[i + 2] = Math.round(BRAND[2] * (1 - a) + WHITE[2] * a);
      out[i + 3] = 255;
    }
  }
  return encodePng(size, out);
}

const TARGETS: Array<{ file: string; size: number }> = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // iOS 的 apple-touch-icon 不认 SVG，也不读 manifest，必须单独给一张 PNG
  { file: 'apple-touch-icon.png', size: 180 },
];

async function main(): Promise<void> {
  const outDir = path.join(ROOT_DIR, 'public');
  await ensureDir(outDir);
  let total = 0;
  for (const t of TARGETS) {
    const buf = drawIcon(t.size);
    fs.writeFileSync(path.join(outDir, t.file), buf);
    total += buf.length;
    console.log(`[gen-icons] ${t.file} ${t.size}×${t.size} → ${buf.length} B`);
  }
  console.log(`[gen-icons] 合计 ${total} B`);
}

main().catch((error: unknown) => {
  console.error('[gen-icons] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
