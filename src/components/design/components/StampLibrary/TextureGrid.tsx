import { useEffect, useRef, useCallback } from 'react';
import { Plus, ClipboardPaste, X } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import { TEXTURE_ASSETS, renderTextureThumbnail, renderTextureToDataUrl } from '../../engine/textureAssets';

export function TextureGrid() {
  const setPlanSelection = useProjectStore((s) => s.setPlanSelection);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const customStamps = useCustomStampStore((s) => s.stamps);
  const removeCustomStamp = useCustomStampStore((s) => s.removeStamp);

  // Filter custom stamps that are textures (name starts with "tex-")
  const customTextures = customStamps.filter(s => s.category === 'textures' || s.name.startsWith('tex-'));

  const handleSelectBuiltin = (textureId: string) => {
    const dataUrl = renderTextureToDataUrl(textureId, 3);
    const img = new Image();
    img.onload = () => {
      setPlanSelection(dataUrl, img.naturalWidth, img.naturalHeight);
      setViewMode('photo');
    };
    img.src = dataUrl;
  };

  const handleSelectCustom = (dataUrl: string, width: number, height: number) => {
    setPlanSelection(dataUrl, width, height);
    setViewMode('photo');
  };

  const handleUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          const img = new window.Image();
          img.onload = () => {
            const name = 'tex-' + file.name.replace(/\.[^.]+$/, '');
            useCustomStampStore.getState().addStampFromDataUrl(
              name, dataUrl, img.naturalWidth, img.naturalHeight, 'textures'
            );
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            const img = new window.Image();
            img.onload = () => {
              useCustomStampStore.getState().addStampFromDataUrl(
                `tex-Pasted ${new Date().toLocaleTimeString()}`,
                dataUrl, img.naturalWidth, img.naturalHeight, 'textures'
              );
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch {
      // Clipboard API not available
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col">
      {/* Upload / Paste buttons */}
      <div className="flex gap-1 mb-2">
        <button
          onClick={handleUpload}
          className="flex-1 flex items-center justify-center gap-1 py-2 px-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors select-none"
        >
          <Plus size={14} />
          Upload
        </button>
        <button
          onClick={handlePaste}
          className="flex-1 flex items-center justify-center gap-1 py-2 px-2 bg-purple-50 text-purple-600 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors select-none"
        >
          <ClipboardPaste size={14} />
          Paste
        </button>
      </div>

      {/* Custom textures */}
      {customTextures.length > 0 && (
        <>
          <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">My Textures</p>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {customTextures.map((tex) => (
              <div
                key={tex.id}
                className="relative flex flex-col items-center p-2 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors select-none group"
                style={{ WebkitTouchCallout: 'none' }}
                onClick={() => handleSelectCustom(tex.dataUrl, tex.naturalWidth, tex.naturalHeight)}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); removeCustomStamp(tex.id); }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <X size={10} />
                </button>
                <div
                  className="w-14 h-14 rounded bg-contain bg-center bg-no-repeat pointer-events-none"
                  style={{ backgroundImage: `url(${tex.dataUrl})`, backgroundSize: 'cover' }}
                />
                <span className="text-[10px] text-gray-500 mt-1 text-center leading-tight truncate w-full">
                  {tex.name.replace('tex-', '')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Built-in textures */}
      <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Built-in</p>
      <div className="grid grid-cols-2 gap-1">
        {TEXTURE_ASSETS.map((tex) => (
          <BuiltinTextureTile key={tex.id} textureId={tex.id} name={tex.name} onSelect={handleSelectBuiltin} />
        ))}
      </div>

      <p className="text-[10px] text-gray-300 text-center mt-3 px-1">
        Tap to place. Drag corners to skew, erase edges, then paste.
      </p>
    </div>
  );
}

function BuiltinTextureTile({ textureId, name, onSelect }: { textureId: string; name: string; onSelect: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const thumbnail = renderTextureThumbnail(textureId);
    const ctx = canvasRef.current.getContext('2d')!;
    canvasRef.current.width = 60;
    canvasRef.current.height = 60;
    ctx.drawImage(thumbnail, 0, 0);
  }, [textureId]);

  return (
    <div
      onClick={() => onSelect(textureId)}
      className="flex flex-col items-center p-2 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors select-none"
      style={{ WebkitTouchCallout: 'none' }}
    >
      <canvas ref={canvasRef} width={60} height={60} className="rounded pointer-events-none" />
      <span className="text-[10px] text-gray-500 mt-1 text-center leading-tight">{name}</span>
    </div>
  );
}
