import styles from "./settings.module.css";

// A shortcut is one action with one or more key combos that trigger it
// (e.g. "Enter" or "Space"). Each combo is a list of keys chorded together.
type Shortcut = { combos: string[][]; desc: string };
type Group = { title: string; shortcuts: Shortcut[] };

// ⌘ entries are written as "⌘/Ctrl" — the app checks metaKey || ctrlKey, so
// they work with Cmd on Mac/iPad and Ctrl on Windows/Linux.
const GROUPS: Group[] = [
  {
    title: "Global",
    shortcuts: [
      { combos: [["⌘/Ctrl", "K"]], desc: "Open the command palette (search photo albums, deals & properties)" },
      { combos: [["Alt/Option", "E"]], desc: "Quick add an event" },
      { combos: [["↑"], ["↓"]], desc: "Move through palette results" },
      { combos: [["Enter"]], desc: "Open the highlighted palette result" },
      { combos: [["Esc"]], desc: "Close the command palette or quick-add" },
    ],
  },
  {
    title: "Sales Board",
    shortcuts: [
      { combos: [["Enter"], ["Space"]], desc: "Open the focused deal card" },
      { combos: [["⌘/Ctrl", "V"]], desc: "Paste an image into an armed Attachment / Correspondence slot" },
      { combos: [["Enter"]], desc: "Create the typed-in new jobsite (address picker)" },
      { combos: [["Esc"]], desc: "Close the deal modal, or cancel new-jobsite entry" },
    ],
  },
  {
    title: "Calendar",
    shortcuts: [
      { combos: [["Enter"], ["Space"]], desc: "Open the focused deal, event, or day" },
      { combos: [["←"], ["→"]], desc: "Previous / next photo (lightbox)" },
      { combos: [["Esc"]], desc: "Close the event details or photo lightbox" },
    ],
  },
  {
    title: "Next Actions",
    shortcuts: [
      { combos: [["Alt/Option", "K"]], desc: "Focus the search box" },
      { combos: [["Enter"], ["↓"]], desc: "Save the edit and move to the next row" },
      { combos: [["↑"]], desc: "Save the edit and move to the previous row" },
      { combos: [["Esc"]], desc: "Discard the edit" },
    ],
  },
  {
    title: "Tasks",
    shortcuts: [{ combos: [["Alt/Option", "N"]], desc: "Open the add-task form" }],
  },
  {
    title: "Photos",
    shortcuts: [
      { combos: [["←"], ["→"]], desc: "Previous / next photo" },
      { combos: [["Enter"]], desc: "Save a caption" },
      { combos: [["Esc"]], desc: "Close the lightbox" },
    ],
  },
  {
    title: "Item Catalog",
    shortcuts: [{ combos: [["Esc"]], desc: "Close the item modal" }],
  },
  {
    title: "Plant Database",
    shortcuts: [
      { combos: [["Enter"]], desc: "Save a cell edit" },
      { combos: [["Esc"]], desc: "Cancel a cell edit" },
    ],
  },
  {
    title: "Properties",
    shortcuts: [{ combos: [["Enter"]], desc: "Search the address (Set location)" }],
  },
  {
    title: "Photo Annotator",
    shortcuts: [
      { combos: [["Alt/Option (hold)"]], desc: "Curve mode for the current segment" },
      { combos: [["Shift (hold)"]], desc: "Constrain / align the active tool" },
      { combos: [["Enter"]], desc: "Finish editing a text label" },
    ],
  },
  {
    title: "Estimator (takeoff)",
    shortcuts: [
      { combos: [["G"]], desc: "New take-off group" },
      { combos: [["/"], ["⌘/Ctrl", "K"]], desc: "Open the catalog picker" },
      { combos: [["1"], ["–"], ["9"]], desc: "Select the Nth plant / catalog item" },
      { combos: [["Tab"]], desc: "Cycle to the next plant / item" },
      { combos: [["Enter"]], desc: "Finish the in-progress shape" },
      { combos: [["Esc"]], desc: "Cancel the in-progress shape" },
      { combos: [["Delete"], ["Backspace"]], desc: "Remove the selected shape, plant, or item" },
    ],
  },
  {
    title: "Design tool",
    shortcuts: [
      { combos: [["⌘/Ctrl", "Z"]], desc: "Undo" },
      { combos: [["⌘/Ctrl", "Shift", "Z"], ["⌘/Ctrl", "Y"]], desc: "Redo" },
      { combos: [["⌘/Ctrl", "D"]], desc: "Duplicate the selected stamp" },
      { combos: [["Delete"], ["Backspace"]], desc: "Remove the selected stamp or light" },
      { combos: [["F"]], desc: "Frame the selected stamp" },
      { combos: [["1"], ["2"], ["3"]], desc: "Switch to Photo / Plan / Lighting view" },
      { combos: [["Esc"]], desc: "Clear the selection" },
    ],
  },
];

function Combos({ combos }: { combos: string[][] }) {
  return (
    <span className={styles.keys}>
      {combos.map((combo, ci) => (
        <span key={ci}>
          {ci > 0 && <span className={styles.keysOr}>or</span>}
          {combo.map((key, ki) => (
            <span key={ki}>
              {ki > 0 && <span className={styles.keysPlus}>+</span>}
              <kbd className={styles.kbd}>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export default function KeyboardShortcuts() {
  return (
    <div className={`${styles.card} ${styles.shortcutsCard}`}>
      <div className={styles.cardHead}>
        <div>
          <h2>Keyboard shortcuts</h2>
          <p>
            ⌘ shortcuts also work with Ctrl on Windows/Linux. On iPad, connect an external keyboard to use these.
          </p>
        </div>
      </div>
      <div className={styles.shortcutGroups}>
        {GROUPS.map((group) => (
          <section key={group.title} className={styles.shortcutGroup}>
            <h3 className={styles.shortcutGroupTitle}>{group.title}</h3>
            <ul className={styles.shortcutList}>
              {group.shortcuts.map((s, i) => (
                <li key={i} className={styles.shortcutRow}>
                  <Combos combos={s.combos} />
                  <span className={styles.shortcutDesc}>{s.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
