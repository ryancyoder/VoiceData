import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlanSymbolStore } from '../../store/useCustomStampStore';
import type { PlacedStamp } from '../../types';

interface PlanStampProps {
  stamp: PlacedStamp;
  isSelected: boolean;
}

export function PlanStamp({ stamp, isSelected }: PlanStampProps) {
  const imageRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [imageSource, setImageSource] = useState<HTMLImageElement | null>(null);

  const updatePlanStamp = useProjectStore((s) => s.updatePlanStamp);
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);

  const symbol = usePlanSymbolStore.getState().getSymbol(stamp.assetId);

  useEffect(() => {
    if (!symbol) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImageSource(img);
    img.src = symbol.dataUrl;
  }, [symbol]);

  useEffect(() => {
    if (isSelected && transformerRef.current && imageRef.current) {
      transformerRef.current.nodes([imageRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  if (!imageSource || !symbol) return null;

  const baseSize = 80;
  const aspect = symbol.naturalWidth / symbol.naturalHeight;
  const width = baseSize * aspect * stamp.manualScale;
  const height = baseSize * stamp.manualScale;

  if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) return null;

  return (
    <>
      <KonvaImage
        ref={imageRef}
        image={imageSource}
        x={stamp.x}
        y={stamp.y}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        rotation={stamp.rotation}
        scaleX={stamp.flipX ? -1 : 1}
        opacity={stamp.opacity}
        draggable={isSelected}
        onClick={() => selectStamp(stamp.id)}
        onTap={() => selectStamp(stamp.id)}
        onDragStart={() => pushHistory()}
        onDragMove={(e) => {
          updatePlanStamp(stamp.id, { x: e.target.x(), y: e.target.y() });
        }}
        onDragEnd={(e) => {
          updatePlanStamp(stamp.id, { x: e.target.x(), y: e.target.y() });
        }}
        onTransformEnd={() => {
          const node = imageRef.current;
          if (!node) return;
          const scaleX = Math.abs(node.scaleX());
          node.scaleX(stamp.flipX ? -1 : 1);
          node.scaleY(1);
          updatePlanStamp(stamp.id, {
            manualScale: stamp.manualScale * scaleX,
            rotation: node.rotation(),
            x: node.x(),
            y: node.y(),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={transformerRef}
          anchorSize={16}
          anchorCornerRadius={8}
          borderStroke="#22c55e"
          borderStrokeWidth={2}
          anchorStroke="#22c55e"
          anchorFill="#ffffff"
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          rotateEnabled={true}
          keepRatio={true}
        />
      )}
    </>
  );
}
