## Electron high-performance wrapper (manual steps)

This repo lives under `public/`. To run the game in a dedicated Chromium shell with performance-friendly flags:

1) Install Electron as a dev dependency from the project root (one level above `public/`):
```bash
npm install --save-dev electron
```

2) Add scripts to your root `package.json` (alongside existing scripts):
```json
"scripts": {
  "start:electron": "cd public && electron electron-main.js",
  "dist:electron": "electron-packager public SpaceGame --platform=win32 --arch=x64 --out=dist --overwrite"
}
```
Adjust `dist` command if you use electron-builder instead of electron-packager.

3) Ensure `electron-main.js` is in `public/` (this file expects `index.html` there). It launches a window with:
   - background throttling disabled
   - vsync/frame-rate limits disabled
   - GPU blocklist ignored
   - powerSaveBlocker engaged
   - best-effort process priority bump

4) Run:
```bash
npm run start:electron
```
to launch the game in the high-performance shell. For packaging, install `electron-packager` or `electron-builder` and run the corresponding `dist` script.

Notes:
- If you serve the game from a dev server instead of `file://`, change `win.loadFile(...)` to `win.loadURL('http://localhost:3000')`.
- To pick a specific ANGLE backend, uncomment `app.commandLine.appendSwitch('use-angle', 'd3d11')` (or `gl`) in `electron-main.js`.
- OS-level GPU preference/priority still depends on the host; for Windows, you can set “High performance” GPU for the packaged EXE in Graphics Settings or vendor control panel.
