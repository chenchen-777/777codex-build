// Electron uses device-independent pixels; keep the compact window on screen.
export function compactWindowBounds(workArea, expanded = false) {
  return {
    width: Math.min(expanded ? 940 : 390, workArea.width),
    height: Math.min(expanded ? 800 : 620, workArea.height),
    minWidth: Math.min(360, workArea.width),
    minHeight: Math.min(520, workArea.height),
  };
}
