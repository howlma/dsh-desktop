// 用纯 Node（zlib + 手写 PNG 块）生成托盘/窗口图标，避免引入图片依赖。
// 画一个深色圆角方块 + 一个居中的 "H"（用像素块近似），32x32。

"use strict";

const zlib = require("node:zlib");

// ---------- PNG 编码基础 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** rgba 像素数组 → PNG Buffer */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
/** 生成 32x32 图标：深色圆角背景 + 亮色 "H" */
function generateIconPng() {
  const S = 32;
  const px = Buffer.alloc(S * S * 4);
  const R = 7; // 圆角半径

  const inRoundRect = (x, y) => {
    const min = R - 0.5;
    const max = S - 1 - R + 0.5;
    if (x >= min && x <= max && y >= min && y <= max) return true;
    // 四个角
    const corners = [
      [R - 0.5, R - 0.5],
      [S - 1 - R + 0.5, R - 0.5],
      [R - 0.5, S - 1 - R + 0.5],
      [S - 1 - R + 0.5, S - 1 - R + 0.5],
    ];
    for (const [cx, cy] of corners) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= R * R) return true;
    }
    return false;
  };

  // 字母 "H" 的矩形区域（在 32x32 中居中）
  const barW = 4.5; // 竖条宽
  const gapX = 1.5; // 两竖条间距
  const top = 9;
  const bottom = 23;
  const crossY = 15.0; // 横梁上下界
  const crossH = 3.5;
  const left = 9.5;
  const right = 22.5;

  const inH = (x, y) => {
    const inBar = (x0, x1) => x >= x0 && x <= x1 && y >= top && y <= bottom;
    if (inBar(left, left + barW) || inBar(right - barW, right)) return true;
    if (y >= crossY && y <= crossY + crossH && x >= left && x <= right) return true;
    return false;
  };

  const bg = [31, 41, 55, 255]; // slate-800
  const fg = [56, 189, 248, 255]; // sky-400
  const edge = [59, 130, 246, 255];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 简单 2x 超采样抗锯齿
      let hits = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const sx = x + ox;
        const sy = y + oy;
        if (inRoundRect(sx, sy)) {
          if (inH(sx, sy)) hits += 3; // 字母
          else hits += 1; // 背景
        }
      }
      if (hits === 0) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
        continue;
      }
      const letterRatio = Math.min(1, hits / 12);
      const bgRatio = Math.min(1, (hits - Math.floor(hits / 3) * 3) / 4) || (hits >= 4 ? 1 : 0);
      const col = letterRatio > 0.5 ? fg : bg;
      const alpha = Math.round(255 * Math.max(letterRatio > 0.5 ? letterRatio : 0, bgRatio));
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = alpha;
      // 描边
      if (bgRatio > 0.9 && letterRatio < 0.4) {
        px[i] = edge[0]; px[i + 1] = edge[1]; px[i + 2] = edge[2];
      }
    }
  }
  return encodePng(S, S, px);
}

module.exports = { generateIconPng };
