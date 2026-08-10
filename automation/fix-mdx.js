// AI 생성 MDX 자동 교정 — 발행 직전에 알려진 컴파일 파손 패턴을 고친다.
//   사용: node automation/fix-mdx.js [파일...]   (인자 없으면 git 미커밋 .mdx 전체)
//
// 배경: 2026-08-07 생성분이 <KeyTakeaways items={[...] /> 로 닫혀(`]}` 아님) acorn 파싱에 실패,
// 발행 워크플로는 빌드를 하지 않으므로 그대로 main 에 올라갔고 Vercel 빌드가 연쇄 실패해
// 8/7~8/9 글 3편이 커밋됐는데도 404 였다. 모델이 가끔 놓치는 패턴이라 사후 교정으로 막는다.
// 여기서 못 잡는 파손은 뒤따르는 '빌드 검증' 게이트가 커밋 자체를 막는다.
import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

// JSX 속성 표현식 `={[ ... ]` 가 `}` 없이 `/>` 로 닫힌 줄.
// 예: items={["a","b"] />   →   items={["a","b"]} />
const UNCLOSED_ATTR = /=\{\[[\s\S]*\]\s*\/>\s*$/;

function repairLine(line) {
  if (!UNCLOSED_ATTR.test(line)) return null;
  // 중괄호가 실제로 하나 모자랄 때만 건드린다(정상 줄을 망가뜨리지 않도록)
  const open = (line.match(/\{/g) || []).length;
  const close = (line.match(/\}/g) || []).length;
  if (open !== close + 1) return null;
  return line.replace(/\]\s*\/>\s*$/, ']} />');
}

async function changedMdx() {
  const out = execSync('git status --porcelain -- "*.mdx"', { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((p) => p.endsWith('.mdx'));
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : await changedMdx();
  if (!files.length) {
    console.log('[fix-mdx] 대상 없음');
    return;
  }

  let fixed = 0;
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    // CRLF 를 보존해야 불필요한 전체 diff 가 생기지 않는다
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let touched = false;

    for (let i = 0; i < lines.length; i++) {
      const repaired = repairLine(lines[i]);
      if (repaired !== null) {
        lines[i] = repaired;
        touched = true;
        fixed++;
        console.log(`[fix-mdx] 교정: ${file}:${i + 1} — 닫는 '}' 보강`);
      }
    }

    if (touched) await fs.writeFile(file, lines.join(eol), 'utf8');
  }

  console.log(fixed ? `[fix-mdx] ${fixed}곳 교정` : '[fix-mdx] 교정할 곳 없음');
}

main().catch((e) => {
  // 교정 실패가 발행을 막아선 안 된다 — 뒤의 빌드 게이트가 최종 판단한다
  console.log(`[fix-mdx] 스킵(${e.message})`);
});
