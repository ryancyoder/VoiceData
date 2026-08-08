import { Line, Circle, Group, Text } from 'react-konva';
import { useProjectStore } from '../../store/useProjectStore';

export function PerspectiveGuides() {
  const perspective = useProjectStore((s) => s.perspective);
  const backgroundWidth = useProjectStore((s) => s.backgroundWidth);
  const toolMode = useProjectStore((s) => s.toolMode);
  const setHorizonY = useProjectStore((s) => s.setHorizonY);
  const pushHistory = useProjectStore((s) => s.pushHistory);

  // Only show when horizon tool is active
  if (toolMode !== 'horizon') return null;

  const lineColor = '#ff6b35';
  const handleRadius = 18;
  const width = backgroundWidth || 1024;

  return (
    <Group>
      {/* Horizon line */}
      <Line
        points={[0, perspective.horizonY, width, perspective.horizonY]}
        stroke={lineColor}
        strokeWidth={2}
        opacity={0.9}
        listening={false}
      />

      {/* Left drag handle */}
      <Circle
        x={40}
        y={perspective.horizonY}
        radius={handleRadius}
        fill={lineColor}
        opacity={0.8}
        draggable
        dragBoundFunc={(pos) => ({
          x: 40,
          y: Math.max(10, Math.min(pos.y, (useProjectStore.getState().backgroundHeight || 768) - 10)),
        })}
        onDragStart={() => pushHistory()}
        onDragMove={(e) => setHorizonY(e.target.y())}
        onDragEnd={(e) => setHorizonY(e.target.y())}
      />

      {/* Right drag handle */}
      <Circle
        x={width - 40}
        y={perspective.horizonY}
        radius={handleRadius}
        fill={lineColor}
        opacity={0.8}
        draggable
        dragBoundFunc={(pos) => ({
          x: width - 40,
          y: Math.max(10, Math.min(pos.y, (useProjectStore.getState().backgroundHeight || 768) - 10)),
        })}
        onDragStart={() => pushHistory()}
        onDragMove={(e) => setHorizonY(e.target.y())}
        onDragEnd={(e) => setHorizonY(e.target.y())}
      />

      {/* Horizon label */}
      <Text
        x={width / 2 - 40}
        y={perspective.horizonY - 25}
        text="HORIZON"
        fontSize={12}
        fontStyle="bold"
        fill={lineColor}
        opacity={0.9}
        listening={false}
        letterSpacing={2}
      />
    </Group>
  );
}
