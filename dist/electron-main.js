const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const path = require('path');

// Apply performance-friendly Chromium flags before app ready
const flags = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--ignore-gpu-blocklist',
  '--enable-accelerated-video',
  '--autoplay-policy=no-user-gesture-required'
];
flags.forEach(f => {
  const [flag, val] = f.includes('=') ? f.split('=') : [f, undefined];
  app.commandLine.appendSwitch(flag.replace(/^--/, ''), val);
});

// Optional: set ANGLE backend explicitly if you know your best path
// app.commandLine.appendSwitch('use-angle', 'd3d11'); // or 'gl'

// Prevent the OS from downclocking while running
let psbId;
app.on('ready', () => {
  psbId = powerSaveBlocker.start('prevent-display-sleep');
});
app.on('will-quit', () => {
  if (psbId && powerSaveBlocker.isStarted(psbId)) powerSaveBlocker.stop(psbId);
});

// Try to bump process priority where supported (best-effort)
try { if (process.setPriority) process.setPriority('high'); } catch (e) { /* ignore */ }

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    useContentSize: true,
    webPreferences: {
      powerPreference: 'high-performance',
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Load the built game; adjust if you serve from a dev server
  const entry = path.join(__dirname, 'index.html');
  win.loadFile(entry);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
