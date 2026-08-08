/**
 * Generate tileable texture pattern canvases for landscape surfaces.
 * Each texture renders a 256x256 repeating tile that can be used
 * as a skewable overlay on the perspective photo.
 */

export interface TextureAsset {
  id: string;
  name: string;
  generate: () => HTMLCanvasElement;
}

function createCanvas(w = 256, h = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

export const TEXTURE_ASSETS: TextureAsset[] = [
  {
    id: 'tex-mulch',
    name: 'Mulch',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#5d3a1a';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(42);
      for (let i = 0; i < 200; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        const w = 8 + rng() * 20;
        const h = 3 + rng() * 6;
        const angle = rng() * Math.PI;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = `hsl(${20 + rng() * 15}, ${40 + rng() * 20}%, ${20 + rng() * 15}%)`;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }
      return c;
    },
  },
  {
    id: 'tex-gravel',
    name: 'Gravel',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(77);
      for (let i = 0; i < 300; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        const r = 2 + rng() * 5;
        const light = 50 + rng() * 40;
        ctx.fillStyle = `hsl(0, 0%, ${light}%)`;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      return c;
    },
  },
  {
    id: 'tex-flagstone',
    name: 'Flagstone',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#b0a090';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(99);
      // Draw irregular stone shapes
      const stones = [
        [10, 10, 100, 80], [120, 10, 130, 90], [10, 100, 110, 80],
        [130, 110, 120, 70], [10, 190, 100, 60], [120, 190, 130, 60],
      ];
      for (const [sx, sy, sw, sh] of stones) {
        ctx.fillStyle = `hsl(${30 + rng() * 10}, ${15 + rng() * 10}%, ${60 + rng() * 15}%)`;
        ctx.strokeStyle = '#8a7a6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(sx, sy, sw, sh, 8);
        ctx.fill();
        ctx.stroke();
      }
      return c;
    },
  },
  {
    id: 'tex-brick',
    name: 'Brick',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, 256, 256);
      const bw = 50, bh = 22, gap = 3;
      const rng = seededRandom(55);
      for (let row = 0; row < 10; row++) {
        const offset = row % 2 === 0 ? 0 : bw / 2 + gap / 2;
        for (let col = -1; col < 6; col++) {
          const x = col * (bw + gap) + offset;
          const y = row * (bh + gap);
          ctx.fillStyle = `hsl(${8 + rng() * 8}, ${50 + rng() * 20}%, ${35 + rng() * 15}%)`;
          ctx.fillRect(x, y, bw, bh);
        }
      }
      return c;
    },
  },
  {
    id: 'tex-grass',
    name: 'Grass',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#3a7a2a';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(33);
      for (let i = 0; i < 500; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        const h = 5 + rng() * 12;
        const lean = (rng() - 0.5) * 6;
        ctx.strokeStyle = `hsl(${100 + rng() * 30}, ${50 + rng() * 30}%, ${25 + rng() * 20}%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + lean, y - h);
        ctx.stroke();
      }
      return c;
    },
  },
  {
    id: 'tex-concrete',
    name: 'Concrete',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#c0bdb8';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(11);
      // Subtle speckles
      for (let i = 0; i < 400; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        ctx.fillStyle = `rgba(${rng() > 0.5 ? 0 : 255}, ${rng() > 0.5 ? 0 : 255}, ${rng() > 0.5 ? 0 : 255}, ${rng() * 0.06})`;
        ctx.fillRect(x, y, 1 + rng() * 3, 1 + rng() * 3);
      }
      return c;
    },
  },
  {
    id: 'tex-water',
    name: 'Water',
    generate: () => {
      const [c, ctx] = createCanvas();
      ctx.fillStyle = '#2a6a9a';
      ctx.fillRect(0, 0, 256, 256);
      const rng = seededRandom(88);
      for (let i = 0; i < 30; i++) {
        const y = rng() * 256;
        ctx.strokeStyle = `rgba(255,255,255,${0.05 + rng() * 0.1})`;
        ctx.lineWidth = 1 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x < 256; x += 20) {
          ctx.quadraticCurveTo(x + 10, y + (rng() - 0.5) * 8, x + 20, y + (rng() - 0.5) * 3);
        }
        ctx.stroke();
      }
      return c;
    },
  },
];

/**
 * Render a texture tile to a data URL for use as a skewable overlay.
 * Tiles the pattern to fill a larger area for better coverage.
 */
export function renderTextureToDataUrl(textureId: string, tileCount = 3): string {
  const asset = TEXTURE_ASSETS.find(t => t.id === textureId);
  if (!asset) return '';

  const tile = asset.generate();
  const size = 256 * tileCount;
  const [c, ctx] = createCanvas(size, size);

  for (let row = 0; row < tileCount; row++) {
    for (let col = 0; col < tileCount; col++) {
      ctx.drawImage(tile, col * 256, row * 256);
    }
  }

  return c.toDataURL('image/png');
}

/**
 * Render a small thumbnail of a texture for the library.
 */
export function renderTextureThumbnail(textureId: string): HTMLCanvasElement {
  const asset = TEXTURE_ASSETS.find(t => t.id === textureId);
  if (!asset) {
    const [c] = createCanvas(60, 60);
    return c;
  }
  const tile = asset.generate();
  const [c, ctx] = createCanvas(60, 60);
  ctx.drawImage(tile, 0, 0, 256, 256, 0, 0, 60, 60);
  return c;
}
