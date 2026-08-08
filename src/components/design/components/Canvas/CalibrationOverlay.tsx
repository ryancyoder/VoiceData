import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Line, Text, Group, Rect } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { renderPersonToCanvas } from '../../engine/personSilhouette';
import { computeBaseScaleFromCalibration } from '../../engine/perspective';

/**
 * The calibration overlay shows a draggable, resizable person silhouette.
 * The user positions it in the photo where a person would stand and resizes
 * it until it "looks right." This calibrates the perspective scale for
 * all stamps.
 *
 * Workflow:
 * 1. User clicks "Calibrate" in toolbar → enters calibrate mode
 * 2. Person silhouette appears at a default position
 * 3. User drags it to a spot in the photo (e.g., near the front door)
 * 4. User drags the top handle to resize until the person looks proportional
 * 5. Clicking "Confirm" saves the calibration and recalculates baseScale
 */
export function CalibrationOverlay() {
  const perspective = useProjectStore((s) => s.perspective);
  const backgroundHeight = useProjectStore((s) => s.backgroundHeight);
  const backgroundWidth = useProjectStore((s) => s.backgroundWidth);
  const toolMode = useProjectStore((s) => s.toolMode);
  const setPerspective = useProjectStore((s) => s.setPerspective);

  const imageRef = useRef<Konva.Image>(null);
  const [personImage, setPersonImage] = useState<HTMLCanvasElement | null>(null);

  // Person state: position (bottom-center) and height in pixels
  const [personX, setPersonX] = useState(backgroundWidth / 2);
  const [personY, setPersonY] = useState(backgroundHeight * 0.75);
  const [personHeight, setPersonHeight] = useState(backgroundHeight * 0.15);

  // Initialize from existing calibration if present
  useEffect(() => {
    if (perspective.calibration) {
      setPersonX(perspective.calibration.x);
      setPersonY(perspective.calibration.y);
      setPersonHeight(perspective.calibration.heightPx);
    } else {
      setPersonX(backgroundWidth / 2);
      setPersonY(backgroundHeight * 0.75);
      setPersonHeight(backgroundHeight * 0.15);
    }
  }, [toolMode, perspective.calibration, backgroundWidth, backgroundHeight]);

  // Render person silhouette image
  useEffect(() => {
    const aspect = 60 / 150; // width/height of person viewbox
    const w = personHeight * aspect;
    const canvas = renderPersonToCanvas(Math.max(1, Math.round(w * 2)), Math.max(1, Math.round(personHeight * 2)));
    setPersonImage(canvas);
  }, [personHeight]);

  // Live-update calibration as the user adjusts
  useEffect(() => {
    if (toolMode !== 'calibrate') return;
    const cal = {
      x: personX,
      y: personY,
      heightPx: personHeight,
      realHeightFt: perspective.calibration?.realHeightFt ?? 5.75,
    };
    const newBaseScale = computeBaseScaleFromCalibration(cal, perspective.horizonY, perspective.groundY);
    setPerspective({ calibration: cal, baseScale: newBaseScale });
  }, [personX, personY, personHeight, toolMode, perspective.horizonY, perspective.groundY]);

  if (toolMode !== 'calibrate' || !personImage) return null;

  const personWidth = personHeight * (60 / 150);

  // Drag handle at the top of the person's head for resizing
  const handleY = personY - personHeight;
  const handleSize = 24;

  return (
    <Group>
      {/* Semi-transparent backdrop to focus attention */}
      <Rect
        x={0}
        y={0}
        width={backgroundWidth}
        height={backgroundHeight}
        fill="rgba(0,0,0,0.15)"
        listening={false}
      />

      {/* Height reference line */}
      <Line
        points={[personX, personY, personX, personY - personHeight]}
        stroke="#0078ff"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
      />

      {/* Person silhouette — draggable to reposition */}
      <KonvaImage
        ref={imageRef}
        image={personImage}
        x={personX}
        y={personY}
        width={personWidth}
        height={personHeight}
        offsetX={personWidth / 2}
        offsetY={personHeight}
        draggable
        onDragEnd={(e) => {
          setPersonX(e.target.x());
          setPersonY(e.target.y());
        }}
      />

      {/* Top resize handle — drag up/down to change person height */}
      <Group
        x={personX}
        y={handleY}
        draggable
        dragBoundFunc={(pos) => {
          // Only allow vertical drag, and keep person height reasonable
          const minHeight = 20;
          const maxHeight = backgroundHeight * 0.6;
          const newHeight = personY - pos.y;
          const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
          return { x: personX, y: personY - clampedHeight };
        }}
        onDragMove={(e) => {
          const newHeight = personY - e.target.y();
          setPersonHeight(Math.max(20, newHeight));
        }}
      >
        {/* Handle visual */}
        <Rect
          x={-handleSize / 2}
          y={-handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#0078ff"
          cornerRadius={handleSize / 2}
          stroke="#fff"
          strokeWidth={2}
        />
        {/* Arrow indicator */}
        <Line
          points={[0, -handleSize / 2 - 6, 0, -handleSize / 2 - 2]}
          stroke="#0078ff"
          strokeWidth={2}
          listening={false}
        />
        <Line
          points={[0, handleSize / 2 + 6, 0, handleSize / 2 + 2]}
          stroke="#0078ff"
          strokeWidth={2}
          listening={false}
        />
      </Group>

      {/* Height label */}
      <Text
        x={personX + personWidth / 2 + 8}
        y={personY - personHeight / 2 - 8}
        text={`${perspective.calibration?.realHeightFt ?? 5.75} ft`}
        fontSize={14}
        fontStyle="bold"
        fill="#0078ff"
        listening={false}
      />

      {/* Instructions */}
      <Text
        x={personX - 120}
        y={personY + 12}
        text="Drag person to position • Drag top handle to resize"
        fontSize={12}
        fill="#0078ff"
        listening={false}
        width={240}
        align="center"
      />
    </Group>
  );
}
