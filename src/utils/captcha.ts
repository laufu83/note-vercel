/**
 * 原生手写SVG验证码，零第三方依赖，完美兼容Cloudflare Worker
 */
function random(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomRgb(): string {
  const r = random(0, 140)
  const g = random(0, 140)
  const b = random(0, 140)
  return `rgb(${r},${g},${b})`
}

// 剔除易混淆字符 0 o O 1 i l I
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function createSvgCaptcha() {
  let code = ''
  let content = ''
  let x = 16

  // 生成4位字符
  for (let i = 0; i < 4; i++) {
    const char = CAPTCHA_CHARS[random(0, CAPTCHA_CHARS.length - 1)]
    code += char
    const y = random(24, 36)
    const rotate = random(-25, 25)
    content += `<text x="${x}" y="${y}" fill="${randomRgb()}" font-size="28" transform="rotate(${rotate} ${x} ${y})">${char}</text>`
    x += 26
  }

  // 干扰线
  for (let i = 0; i < 4; i++) {
    const x1 = random(0, 120)
    const y1 = random(0, 40)
    const x2 = random(0, 120)
    const y2 = random(0, 40)
    content += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randomRgb()}" stroke-width="1"/>`
  }

  // 噪点
  for (let i = 0; i < 22; i++) {
    const cx = random(0, 120)
    const cy = random(0, 40)
    content += `<circle cx="${cx}" cy="${cy}" r="1" fill="${randomRgb()}"/>`
  }

  const svg = `<svg width="120" height="40" xmlns="http://www.w3.org/2000/svg" style="background:#f7f7f7;border-radius:6px">${content}</svg>`
  return {
    code: code.toUpperCase(),
    svg
  }
}