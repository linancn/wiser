import { familyColor, type NodeFamily } from '@/lib/business-scene-style';

/** Shapes encode the same type families as color, including in monochrome. */
export function BusinessSceneGlyph({
  family,
  x,
  y,
  size = 5,
}: {
  family: NodeFamily;
  x: number;
  y: number;
  size?: number;
}) {
  const common = {
    fill: familyColor(family),
    stroke: 'var(--surface)',
    strokeWidth: 0.6,
  };
  if (family === 'water') return <circle cx={x} cy={y} r={size} {...common} />;
  if (family === 'site' || family === 'asset')
    return (
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        rx={family === 'asset' ? size / 2 : 0}
        {...common}
      />
    );
  const vertices =
    family === 'action'
      ? 4
      : family === 'claim'
        ? 6
        : family === 'actor'
          ? 3
          : family === 'observation'
            ? 5
            : 8;
  const points = Array.from({ length: vertices }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / vertices;
    return `${x + Math.cos(angle) * size},${y + Math.sin(angle) * size}`;
  }).join(' ');
  return <polygon points={points} {...common} />;
}
