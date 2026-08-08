import { Trash2, Copy } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { LIGHT_PRESET_LABELS } from './lightPresets';
import type { LightPreset } from '../../types';

export function LightPropertiesPanel() {
  const selectedLightId = useProjectStore((s) => s.selectedLightId);
  const lights = useProjectStore((s) => s.lightingConfig.lights);
  const updateLight = useProjectStore((s) => s.updateLight);
  const removeLight = useProjectStore((s) => s.removeLight);
  const duplicateLight = useProjectStore((s) => s.duplicateLight);

  const light = selectedLightId ? lights.find((l) => l.id === selectedLightId) : null;
  if (!light) return null;

  const isCone = (light.beamAngle ?? 360) < 360;

  const sliders: { label: string; key: string; min: number; max: number; step: number; value: number; show?: boolean }[] = [
    { label: 'Intensity', key: 'intensity', min: 0, max: 1, step: 0.05, value: light.intensity },
    { label: 'Beam °', key: 'beamAngle', min: 10, max: 360, step: 5, value: light.beamAngle ?? 360 },
    { label: 'Distance', key: 'distance', min: 30, max: 500, step: 10, value: light.distance ?? 120 },
    { label: 'Radius', key: 'radius', min: 20, max: 300, step: 5, value: light.radius, show: !isCone },
    { label: 'Spread X', key: 'spreadX', min: 0.3, max: 2.5, step: 0.1, value: light.spreadX, show: !isCone },
    { label: 'Spread Y', key: 'spreadY', min: 0.3, max: 2.5, step: 0.1, value: light.spreadY, show: !isCone },
    { label: 'Rotation', key: 'rotation', min: 0, max: 360, step: 5, value: light.rotation },
  ].filter((s) => s.show !== false);

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 px-4 py-3 z-20">
      <div className="flex items-center gap-3 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Preset quick-apply */}
        <div className="flex gap-1 shrink-0">
          {(['uplight', 'path', 'spotlight'] as LightPreset[]).map((preset) => (
            <button
              key={preset}
              onClick={() => {
                const defaults: Record<string, Partial<{ spreadX: number; spreadY: number; radius: number; beamAngle: number; distance: number }>> = {
                  uplight:   { spreadX: 0.6, spreadY: 1.8, radius: 120, beamAngle: 60, distance: 200 },
                  path:      { spreadX: 1.0, spreadY: 1.0, radius: 80, beamAngle: 360, distance: 80 },
                  spotlight: { spreadX: 0.7, spreadY: 1.2, radius: 150, beamAngle: 45, distance: 250 },
                };
                const d = defaults[preset]!;
                updateLight(light.id, { type: preset, ...d });
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                light.type === preset
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-500 border border-gray-300'
              }`}
            >
              {LIGHT_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>

        <div className="w-px h-8 bg-gray-200 shrink-0" />

        {/* Sliders */}
        {sliders.map(({ label, key, min, max, step, value }) => (
          <div key={key} className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-gray-500 font-medium w-14 text-right">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => updateLight(light.id, { [key]: parseFloat(e.target.value) })}
              className="w-20 h-1.5 accent-amber-500"
            />
            <span className="text-[10px] text-gray-600 w-8">
              {key === 'intensity' ? `${Math.round(value * 100)}%` : Math.round(value)}
            </span>
          </div>
        ))}

        <div className="w-px h-8 bg-gray-200 shrink-0" />

        {/* Actions */}
        <button
          onClick={() => duplicateLight(light.id)}
          className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-blue-100 hover:text-blue-600 transition-colors shrink-0"
          title="Duplicate"
        >
          <Copy size={16} />
        </button>
        <button
          onClick={() => removeLight(light.id)}
          className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors shrink-0"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
