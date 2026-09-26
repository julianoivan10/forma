import { formatMultiplier, GLYPH_HEX, glyphModel } from "@forma/sdk";

export interface GlyphInput {
  id: bigint;
  principal: bigint;
  startTime: bigint;
  unlockTime: bigint;
  activeMultiplierBps: number;
}

/**
 * The position as a protocol object. Same encoding as the on-chain PositionRenderer:
 * tick density = principal tier · arc = lock progress · arc weight = active multiplier ·
 * hue = lock tier · rotation = position id.
 */
export function PositionGlyph({
  input,
  now,
  size = 160,
  showMultiplier = true,
  animate = true,
  title,
}: {
  input: GlyphInput;
  now: bigint;
  size?: number;
  showMultiplier?: boolean;
  animate?: boolean;
  title?: string;
}) {
  const g = glyphModel({ ...input, nowSeconds: now });
  const color = GLYPH_HEX[g.hue];
  const ticks = Array.from({ length: g.tickCount }, (_, i) => i);
  return (
    <svg
      viewBox="-120 -120 240 240"
      width={size}
      height={size}
      role="img"
      aria-label={
        title ??
        `Position ${input.id.toString()} glyph: lock ${(g.progress / 10).toFixed(0)}% complete, ${formatMultiplier(input.activeMultiplierBps)} active multiplier`
      }
      className="shrink-0"
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <g transform={`rotate(${g.rotation})`}>
        <g stroke="#0e1a2b" strokeWidth={1.5}>
          {ticks.map((i) => (
            <line
              key={i}
              x1={0}
              y1={-112}
              x2={0}
              y2={i % 4 === 0 ? -100 : -106}
              transform={`rotate(${(i * 360) / g.tickCount})`}
            />
          ))}
        </g>
        <circle r={86} fill="none" stroke="#0e1a2b" strokeOpacity={0.12} strokeWidth={g.strokeWidth} />
        <circle
          r={86}
          fill="none"
          stroke={color}
          strokeWidth={g.strokeWidth}
          pathLength={1000}
          strokeDasharray={`${g.progress} 1000`}
          transform="rotate(-90)"
          className={animate ? "animate-arc" : undefined}
        />
        <circle r={58} fill="#0e1a2b" />
      </g>
      {showMultiplier && (
        <text
          x={0}
          y={8}
          textAnchor="middle"
          fill="#f3efe4"
          fontSize={24}
          fontWeight={800}
          style={{ fontFamily: "var(--font-display)", fontStretch: "112%" }}
        >
          {formatMultiplier(input.activeMultiplierBps)}
        </text>
      )}
    </svg>
  );
}
