import { Circle, Text, Group } from 'react-konva';
import { useProjectStore } from '../../store/useProjectStore';
import { planToPhoto } from '../../engine/planMapping';
import { getAssetById } from '../../engine/stampAssets';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import type { PlacedStamp } from '../../types';

interface PlanStampCircleProps {
  stamp: PlacedStamp;
  planX: number;
  planY: number;
  radius: number;
  isSelected: boolean;
  planScale: number;
}

export function PlanStampCircle({ stamp, planX, planY, radius, isSelected, planScale }: PlanStampCircleProps) {
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const updateStamp = useProjectStore((s) => s.updateStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);
  const perspective = useProjectStore((s) => s.perspective);

  const isCustom = stamp.assetId.startsWith('custom-');
  const builtinAsset = isCustom ? null : getAssetById(stamp.assetId);
  const customStamp = isCustom ? useCustomStampStore.getState().getStamp(stamp.assetId) : null;

  const name = builtinAsset?.name ?? customStamp?.name ?? '?';
  const color = builtinAsset?.colors[0] ?? '#4a90d9';
  const clampedRadius = Math.max(8, radius);

  return (
    <Group
      x={planX}
      y={planY}
      draggable
      onClick={() => selectStamp(stamp.id)}
      onTap={() => selectStamp(stamp.id)}
      onDragStart={() => pushHistory()}
      onDragEnd={(e) => {
        const newPlanX = e.target.x();
        const newPlanY = e.target.y();
        const { photoX, photoY } = planToPhoto(newPlanX, newPlanY, perspective, planScale);
        updateStamp(stamp.id, { x: photoX, y: photoY });
      }}
    >
      {/* Canopy circle */}
      <Circle
        radius={clampedRadius}
        fill={color}
        opacity={isSelected ? 0.6 : 0.35}
        stroke={isSelected ? '#2196f3' : color}
        strokeWidth={isSelected ? 3 : 1.5}
      />

      {/* Label */}
      <Text
        text={name}
        fontSize={Math.min(11, clampedRadius * 0.7)}
        fill="#333"
        align="center"
        verticalAlign="middle"
        width={clampedRadius * 2}
        height={clampedRadius * 2}
        offsetX={clampedRadius}
        offsetY={clampedRadius}
        listening={false}
      />
    </Group>
  );
}
