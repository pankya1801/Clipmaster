// One shared list for the Inspector panel and the `?` cheat-sheet modal,
// so the two places can't drift apart.
export const SHORTCUTS: [key: string, what: string][] = [
  ["Space", "Play / pause"],
  ["S", "Split at playhead"],
  ["Del", "Delete"],
  ["Shift+Del", "Ripple delete"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+D", "Duplicate"],
  ["T", "Add text"],
  ["← / →", "Step one frame"],
  ["Ctrl+S", "Save"],
  ["Ctrl+I", "Import"],
  ["Ctrl+E", "Export"],
  ["Ctrl+scroll", "Zoom timeline"],
  ["?", "This cheat-sheet"],
];
