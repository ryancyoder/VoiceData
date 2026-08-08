import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import { calculateScale } from '../../engine/perspective';
import { getAssetById, renderStampToCanvas } from '../../engine/stampAssets';
import type { PlacedStamp } from '../../types';

interface PlantStampProps {
  stamp: PlacedStamp;
  isSelected: boolean;
}

export function PlantStamp({ stamp, isSelected }: PlantStampProps) {
  const imageRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [imageSource, setImageSource] = useState<HTMLCanvasElement | HTMLImageElement | null>(null);
  const [assetSize, setAssetSize] = useState({ width: 100, height: 100 });

  const perspective = useProjectStore((s) => s.perspective);
  const updateStamp = useProjectStore((s) => s.updateStamp);
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);
  const toolMode = useProjectStore((s) => s.toolMode);
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const stamps = useProjectStore((s) => s.stamps);

  // Lock: only the selected stamp is draggable.
  // Only stamps of the same assetId are selectable while one is selected.
  const selectedStamp = selectedStampId ? stamps.find((s) => s.id === selectedStampId) : null;
  const isLocked = selectedStamp && selectedStamp.assetId !== stamp.assetId;
  const canDrag = isSelected && toolMode === 'select';
  const canSelect = !isLocked || isSelected;

  const isCustom = stamp.assetId.startsWith('custom-');
  const builtinAsset = isCustom ? null : getAssetById(stamp.assetId);
  const customStamp = isCustom ? useCustomStampStore.getState().getStamp(stamp.assetId) : null;

  // Render the stamp image (SVG canvas for built-in, HTMLImage for custom)
  useEffect(() => {
    if (builtinAsset) {
      const canvas = renderStampToCanvas(builtinAsset, builtinAsset.defaultWidth * 2, builtinAsset.defaultHeight * 2);
      setImageSource(canvas);
      setAssetSize({ width: builtinAsset.defaultWidth, height: builtinAsset.defaultHeight });
    } else if (customStamp) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setImageSource(img);
        // Normalize custom stamps to ~100px base height for consistent perspective scaling
        const aspect = img.naturalWidth / img.naturalHeight;
        const baseHeight = 100;
        setAssetSize({ width: baseHeight * aspect, height: baseHeight });
      };
      img.src = customStamp.dataUrl;
    }
  }, [builtinAsset, customStamp]);

  // Attach transformer when selected
  useEffect(() => {
    if (isSelected && transformerRef.current && imageRef.current) {
      transformerRef.current.nodes([imageRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  if (!imageSource) return null;

  // Calculate perspective-based scale
  const perspectiveScale = calculateScale(stamp.y, perspective);
  const totalScale = perspectiveScale * stamp.manualScale;

  const width = assetSize.width * totalScale;
  const height = assetSize.height * totalScale;

  // Guard against invalid dimensions that would crash Konva
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
        offsetY={height} // Anchor at bottom center for perspective
        rotation={stamp.rotation}
        scaleX={stamp.flipX ? -1 : 1}
        opacity={isLocked ? stamp.opacity * 0.5 : stamp.opacity}
        draggable={canDrag}
        listening={canSelect}
        onClick={() => { if (canSelect) selectStamp(stamp.id); }}
        onTap={() => { if (canSelect) selectStamp(stamp.id); }}
        onDragStart={() => pushHistory()}
        onDragMove={(e) => {
          // Live update position so perspective scale recalculates during drag
          updateStamp(stamp.id, {
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onDragEnd={(e) => {
          updateStamp(stamp.id, {
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={() => {
          const node = imageRef.current;
          if (!node) return;
          const scaleX = Math.abs(node.scaleX());
          const newManualScale = stamp.manualScale * scaleX;
          node.scaleX(stamp.flipX ? -1 : 1);
          node.scaleY(1);
          updateStamp(stamp.id, {
            manualScale: newManualScale,
            rotation: node.rotation(),
            x: node.x(),
            y: node.y(),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(_oldBox, newBox) => {
            if (newBox.width < 20 || newBox.height < 20) return _oldBox;
            return newBox;
          }}
          anchorSize={16}
          anchorCornerRadius={8}
          borderStroke="#4fc3f7"
          borderStrokeWidth={2}
          anchorStroke="#4fc3f7"
          anchorFill="#ffffff"
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          rotateEnabled={true}
          keepRatio={true}
        />
      )}
    </>
  );
}
