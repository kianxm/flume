/**
 * A quiet, label-free Sankey in the product's own shape: income on the left,
 * one total in the middle, spending and savings on the right. Pure geometry,
 * so the server and the client draw exactly the same paths.
 */

const W = 560;
const H = 200;
const NODE = 6;
const MID_X = (W - NODE) / 2;

const INCOME = [96, 40, 12];
const OUTGO = [50, 32, 24, 18, 14, 10];
const TOTAL = INCOME.reduce((a, b) => a + b, 0);

function stack(values: number[], gap: number) {
  const height = values.reduce((a, b) => a + b, 0) + gap * (values.length - 1);
  let y = (H - height) / 2;
  return values.map((v) => {
    const band = { y0: y, y1: y + v };
    y += v + gap;
    return band;
  });
}

function ribbon(x1: number, a0: number, a1: number, x2: number, b0: number, b1: number) {
  const m = (x1 + x2) / 2;
  const f = (n: number) => Math.round(n * 100) / 100;
  return (
    `M${f(x1)} ${f(a0)}C${f(m)} ${f(a0)} ${f(m)} ${f(b0)} ${f(x2)} ${f(b0)}` +
    `L${f(x2)} ${f(b1)}C${f(m)} ${f(b1)} ${f(m)} ${f(a1)} ${f(x1)} ${f(a1)}Z`
  );
}

const left = stack(INCOME, 16);
const right = stack(OUTGO, 9);
const mid = { y0: (H - TOTAL) / 2, y1: (H + TOTAL) / 2 };

function midBands(values: number[]) {
  let y = mid.y0;
  return values.map((v) => {
    const band = { y0: y, y1: y + v };
    y += v;
    return band;
  });
}

const midIn = midBands(INCOME);
const midOut = midBands(OUTGO);

export function FlowSketch({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="text-accent" fill="currentColor">
        {left.map((b, i) => (
          <path
            key={`in${i}`}
            d={ribbon(NODE, b.y0, b.y1, MID_X, midIn[i].y0, midIn[i].y1)}
            opacity={0.34 - i * 0.08}
          />
        ))}
        {left.map((b, i) => (
          <rect key={`inn${i}`} x={0} y={b.y0} width={NODE} height={b.y1 - b.y0} rx={1.5} />
        ))}
      </g>
      <g className="text-text-faint" fill="currentColor">
        {right.map((b, i) => (
          <path
            key={`out${i}`}
            d={ribbon(MID_X + NODE, midOut[i].y0, midOut[i].y1, W - NODE, b.y0, b.y1)}
            opacity={i === OUTGO.length - 1 ? 0.14 : 0.3 - i * 0.03}
          />
        ))}
        {right.map((b, i) => (
          <rect key={`outn${i}`} x={W - NODE} y={b.y0} width={NODE} height={b.y1 - b.y0} rx={1.5} />
        ))}
      </g>
      <rect
        className="text-text"
        fill="currentColor"
        x={MID_X}
        y={mid.y0}
        width={NODE}
        height={mid.y1 - mid.y0}
        rx={1.5}
      />
    </svg>
  );
}
