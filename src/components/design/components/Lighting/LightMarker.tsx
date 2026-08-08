import { Circle, Group, Ring } from 'react-konva';
import type { LightSource } from '../../types';

interface Props {
  light: LightSource;
  bgWidth: number;
  bgHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}

export function LightMarker({ light, bgWidth, bgHeight, isSelected, onSelect, onMove }: Props) {
  const px = light.x * bgWidth;
  const py = light.y * bgHeight;
  const markerRadius = 12;

  return (
    <Group
      x={px}
      y={py}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        const newX = Math.max(0, Math.min(1, e.target.x() / bgWidth));
        const newY = Math.max(0, Math.min(1, e.target.y() / bgHeight));
        onMove(newX, newY);
      }}
    >
      {/* Selection ring */}
      {isSelected && (
        <Ring
          innerRadius={markerRadius + 2}
          outerRadius={markerRadius + 6}
          fill="rgba(255, 200, 50, 0.8)"
        />
      )}
      {/* Outer glow */}
      <Circle
        radius={markerRadius + 2}
        fill="rgba(0,0,0,0.3)"
      />
      {/* Main circle */}
      <Circle
        radius={markerRadius}
        fill={isSelected ? '#fbbf24' : '#ffffff'}
        stroke={isSelected ? '#f59e0b' : 'rgba(255,255,255,0.6)'}
        strokeWidth={2}
      />
      {/* Type indicator dot */}
      <Circle
        radius={3}
        fill={light.type === 'uplight' ? '#f97316' : light.type === 'spotlight' ? '#3b82f6' : '#a3e635'}
      />
    </Group>
  );
}
