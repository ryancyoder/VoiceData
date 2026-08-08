import { useEffect, useState, useRef } from 'react';
import { Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';

/**
 * Combined filter: saturation + brightness + contrast in one pass.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ImageFilter(this: any, imageData: ImageData) {
  const sat: number = this.saturationAmount ?? 1;
  const bright: number = this.brightnessAmount ?? 0;
  const cont: number = this.contrastAmount ?? 0;

  const data = imageData.data;
  // Contrast factor: map -1..1 to multiplier
  const contFactor = cont >= 0 ? 1 + cont * 2 : 1 + cont;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Saturation (luminance-weighted grayscale blend)
    if (sat < 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sat;
      g = gray + (g - gray) * sat;
      b = gray + (b - gray) * sat;
    }

    // Brightness (additive, scaled to 255)
    if (bright !== 0) {
      const adj = bright * 255;
      r += adj;
      g += adj;
      b += adj;
    }

    // Contrast (pivot around 128)
    if (cont !== 0) {
      r = (r - 128) * contFactor + 128;
      g = (g - 128) * contFactor + 128;
      b = (b - 128) * contFactor + 128;
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
}

export function BackgroundImage() {
  const backgroundImage = useProjectStore((s) => s.backgroundImage);
  const saturation = useProjectStore((s) => s.backgroundSaturation);
  const opacity = useProjectStore((s) => s.backgroundOpacity);
  const brightness = useProjectStore((s) => s.backgroundBrightness);
  const contrast = useProjectStore((s) => s.backgroundContrast);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageRef = useRef<Konva.Image>(null);

  useEffect(() => {
    if (!backgroundImage) { setImage(null); return; }
    const img = new window.Image();
    img.src = backgroundImage;
    img.onload = () => setImage(img);
  }, [backgroundImage]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    (node as any).saturationAmount = saturation;
    (node as any).brightnessAmount = brightness;
    (node as any).contrastAmount = contrast;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [saturation, brightness, contrast, image]);

  if (!image) return null;

  const needsFilter = saturation < 1 || brightness !== 0 || contrast !== 0;

  return (
    <KonvaImage
      ref={imageRef}
      image={image}
      x={0}
      y={0}
      width={image.naturalWidth}
      height={image.naturalHeight}
      listening={false}
      opacity={opacity}
      filters={needsFilter ? [ImageFilter as any] : []}
    />
  );
}
