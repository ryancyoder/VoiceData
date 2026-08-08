import { useMemo, useRef } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { usePlanSymbolStore } from '../../store/useCustomStampStore';
import { buildClusters, renderClusterOutline, stampRadius, type Circle, type RenderedOutline } from './clusterUtils';
import type { PlacedStamp } from '../../types';

interface ClusterOverlayProps {
  stamps: PlacedStamp[];
}

/**
 * Renders outer-only outlines around clusters of overlapping same-type stamps.
 * Individual stamps render normally below this overlay — these outlines are
 * purely decorative (listening=false).
 */
export function ClusterOverlay({ stamps }: ClusterOverlayProps) {
  // Subscribe to symbols store so outlines update if a symbol changes
  const symbols = usePlanSymbolStore((s) => s.symbols);

  // Build clusters. Memoize on stamps + symbols reference.
  const clusters = useMemo(() => {
    const getSymbol = (id: string) => symbols.find((s) => s.id === id);
    return buildClusters(stamps, getSymbol);
  }, [stamps, symbols]);

  // Cache rendered outlines by stable key
  const cacheRef = useRef<Map<string, RenderedOutline>>(new Map());

  const outlines = useMemo(() => {
    const getSymbol = (id: string) => symbols.find((s) => s.id === id);
    const results: Array<{ key: string; cached: RenderedOutline }> = [];
    const seen = new Set<string>();

    for (const cluster of clusters) {
      // Stable key: sorted stamp id + rounded position + scale
      const key = cluster
        .map((s) => `${s.id}:${Math.round(s.x)}:${Math.round(s.y)}:${s.manualScale}`)
        .sort()
        .join('|');

      seen.add(key);

      let cached = cacheRef.current.get(key);
      if (!cached) {
        const circles: Circle[] = cluster.map((s) => {
          const sym = getSymbol(s.assetId);
          return {
            x: s.x,
            y: s.y,
            r: sym ? stampRadius(s, sym) : 40,
          };
        });
        cached = renderClusterOutline(circles);
        cacheRef.current.set(key, cached);
      }
      results.push({ key, cached });
    }

    // Evict stale entries
    for (const k of Array.from(cacheRef.current.keys())) {
      if (!seen.has(k)) cacheRef.current.delete(k);
    }

    return results;
  }, [clusters, symbols]);

  return (
    <>
      {outlines.map(({ key, cached }) => (
        <KonvaImage
          key={key}
          image={cached.canvas}
          x={cached.offsetX}
          y={cached.offsetY}
          listening={false}
        />
      ))}
    </>
  );
}
