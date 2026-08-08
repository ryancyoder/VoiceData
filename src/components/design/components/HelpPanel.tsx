import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

// A self-contained Help button + cheat-sheet modal (mirrors how SettingsMenu
// manages its own open state). Documents the tools, gestures, and the keyboard
// shortcuts wired up in DesignApp.

interface HelpItem {
  label: string;
  desc: string;
}

interface HelpSection {
  title: string;
  items: HelpItem[];
}

const SECTIONS: HelpSection[] = [
  {
    title: 'Views',
    items: [
      { label: 'Photo', desc: 'Perspective view — place plants on a jobsite photo; they auto-scale by depth.' },
      { label: 'Plan', desc: '2D top-down view — lay symbols out on a plan and warp a crop onto the photo.' },
      { label: 'Lighting', desc: 'Darken the scene and place uplights, path lights, and spotlights.' },
    ],
  },
  {
    title: 'Getting started',
    items: [
      { label: 'Upload Photo', desc: 'Pick a jobsite photo from your device as the background.' },
      { label: 'Use Jobsite Photo', desc: 'On a deal-linked design, pick a photo already on the deal (from the toolbar).' },
      { label: 'Set the Horizon', desc: 'Drag the horizon line so plants shrink correctly toward the back of the scene.' },
      { label: 'Calibrate', desc: 'Drop the person silhouette where someone would stand and size it to real height — this fixes the perspective scale.' },
    ],
  },
  {
    title: 'Placing & editing plants',
    items: [
      { label: 'Add a plant', desc: 'Tap a plant in the right-hand library, then tap the photo to drop it.' },
      { label: 'Move', desc: 'Drag a placed plant. Turn on Move mode (left sidebar) to reposition without the resize handles.' },
      { label: 'Resize / rotate', desc: 'Use the corner handles, the vertical Size slider (left), or the Size/Rotate sliders in the selected-item bar.' },
      { label: 'Selected-item bar', desc: 'When a plant is selected: Size, Opacity, Rotate, Flip, Bring Forward / Send Back, Duplicate, Delete.' },
      { label: 'Duplicate mode', desc: 'The stamp/duplicate toggle in the left sidebar quickly repeats the selected plant.' },
      { label: 'Plant Database', desc: 'Opens the full library table to rename plants and edit botanical / common names and notes.' },
    ],
  },
  {
    title: 'Plan view',
    items: [
      { label: 'Upload Plan Image', desc: 'Bring in a plan drawing to trace or warp onto the photo.' },
      { label: 'Lock Size', desc: 'Lock a plan symbol’s size as its default so it drops at the right scale next time.' },
      { label: 'Cluster Outlines', desc: 'Toggle grouped outlines around massed plantings.' },
      { label: 'Object Eraser', desc: 'Remove placed plan symbols by tapping them.' },
      { label: 'Paste Overlay', desc: 'Flatten the warped plan crop down onto the photo.' },
    ],
  },
  {
    title: 'Finishing',
    items: [
      { label: 'Export PNG', desc: 'Download the finished rendering (also saved as the design’s preview on the deal).' },
      { label: 'Import / Export Library', desc: 'Back up or move your plant library as a JSON file.' },
      { label: 'Settings', desc: 'Photo saturation / brightness / contrast / opacity, and horizon adjust.' },
    ],
  },
];

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: '1 / 2 / 3', desc: 'Switch Photo / Plan / Lighting view' },
  { keys: '⌘/Ctrl + Z', desc: 'Undo' },
  { keys: '⌘/Ctrl + Shift + Z', desc: 'Redo' },
  { keys: '⌘/Ctrl + D', desc: 'Duplicate selected' },
  { keys: 'F', desc: 'Flip selected horizontally' },
  { keys: 'Delete / Backspace', desc: 'Delete selected plant or light' },
  { keys: 'Esc', desc: 'Deselect' },
];

export function HelpPanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-11 h-11 flex items-center justify-center rounded-lg transition-colors text-gray-600 hover:bg-gray-100 cursor-pointer"
        title="Help & shortcuts"
      >
        <HelpCircle size={20} />
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} />
      <div
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <span className="text-sm font-semibold text-gray-800">Help &amp; shortcuts</span>
          <button
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-5 sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {section.title}
                </h3>
                <dl className="space-y-2">
                  {section.items.map((item) => (
                    <div key={item.label}>
                      <dt className="text-sm font-medium text-gray-800">{item.label}</dt>
                      <dd className="text-xs leading-snug text-gray-500">{item.desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Keyboard shortcuts
            </h3>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <tbody>
                  {SHORTCUTS.map((s, i) => (
                    <tr key={s.keys} className={i % 2 ? 'bg-gray-50/60' : ''}>
                      <td className="w-48 whitespace-nowrap px-3 py-1.5">
                        <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                          {s.keys}
                        </kbd>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{s.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Shortcuts work on a keyboard; everything is also reachable by tapping on iPad.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
