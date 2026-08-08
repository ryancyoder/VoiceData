import { useEffect, useRef } from 'react';
import type { StampAsset } from '../../types';
import { renderStampToCanvas } from '../../engine/stampAssets';
import { useProjectStore } from '../../store/useProjectStore';

interface StampCardProps {
  asset: StampAsset;
}

export function StampCard({ asset }: StampCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setPendingStamp = useProjectStore((s) => s.setPendingStamp);
  const pendingStampAssetId = useProjectStore((s) => s.pendingStampAssetId);
  const isActive = pendingStampAssetId === asset.id;

  useEffect(() => {
    if (!canvasRef.current) return;
    const rendered = renderStampToCanvas(asset, 60, 60);
    const ctx = canvasRef.current.getContext('2d')!;
    canvasRef.current.width = 60;
    canvasRef.current.height = 60;
    ctx.clearRect(0, 0, 60, 60);
    ctx.drawImage(rendered, 0, 0);
  }, [asset]);

  const handleClick = () => {
    setPendingStamp(isActive ? null : asset.id);
  };

  return (
    <div
      onClick={handleClick}
      className={`flex flex-col items-center p-2 rounded-lg cursor-pointer transition-colors select-none ${
        isActive ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-gray-100'
      }`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      <canvas
        ref={canvasRef}
        width={60}
        height={60}
        className="pointer-events-none"
      />
      <span className={`text-[10px] mt-1 text-center leading-tight select-none ${
        isActive ? 'text-blue-600 font-medium' : 'text-gray-500'
      }`}>
        {asset.name}
      </span>
    </div>
  );
}
