import { defineConfig } from 'vite';
import { resolve } from 'path';
import path from 'path';
const pathSep = path.sep;
import fs from 'fs';

// Simple copy plugin to bring non-bundled assets (models, textures, libs, etc.)
// into dist so the built game runs without 404s.
function copyStatic() {
  const dirs = ['models', 'textures', 'scene', 'libs', 'docs', 'scripts'];
  const files = new Set([
    'render-worker.js',
    'service-worker.js',
    'shader-manifest.json',
    'viewer.html',
    'viewer.js',
    'editor.html',
    'favicon.ico'
  ]);
  const rootDir = resolve(__dirname, 'public');
  const outDir  = resolve(__dirname, 'dist');

const copyIfExists = (src, dest) => {
  if (!fs.existsSync(src)) return;

  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      // Never copy git internals (Windows file-lock hell)
      return !source.includes(`${pathSep}.git${pathSep}`) &&
             !source.endsWith(`${pathSep}.git`);
    }
  });
};


  return {
    name: 'copy-static-public',
    closeBundle() {
      // add all top-level JS modules (so worker can import main.js and friends)
      fs.readdirSync(rootDir)
        .filter(f => f.endsWith('.js'))
        .forEach(f => files.add(f));

      dirs.forEach(dir => copyIfExists(resolve(rootDir, dir), resolve(outDir, dir)));
      files.forEach(file => copyIfExists(resolve(rootDir, file), resolve(outDir, file)));
    }
  };
}

export default defineConfig({
  root: 'public',
  base: './',
  plugins: [copyStatic()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        editor: resolve(__dirname, 'public/editor.html')
      },
      output: {
        manualChunks: {
          three: [
            resolve(__dirname, 'public/libs/build/three.module.js'),
            resolve(__dirname, 'public/libs/examples/jsm/loaders/GLTFLoader.js')
          ]
        }
      }
    },
    chunkSizeWarningLimit: 1024
  },
  server: {
    open: false,
    configureServer(server) {
      server.middlewares.use('/__save_spawns', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const spawns = payload?.spawns;
            if (!spawns || typeof spawns !== 'object') {
              res.statusCode = 400;
              res.end('Missing spawns');
              return;
            }
            const formatValue = (val) => {
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                const inner = Object.keys(val)
                  .map((k) => `${JSON.stringify(k)}: ${formatValue(val[k])}`)
                  .join(', ');
                return `{ ${inner} }`;
              }
              if (Array.isArray(val)) {
                if (!val.length) return '[]';
                const inner = val.map((v) => formatValue(v)).join(', ');
                return `[ ${inner} ]`;
              }
              return JSON.stringify(val);
            };
            const formatTop = (obj) => {
              const keys = Object.keys(obj);
              const lines = ['{'];
              keys.forEach((k, idx) => {
                const v = obj[k];
                const comma = idx < keys.length - 1 ? ',' : '';
                if (Array.isArray(v)) {
                  if (!v.length) {
                    lines.push(`  ${JSON.stringify(k)}: []${comma}`);
                    return;
                  }
                  lines.push(`  ${JSON.stringify(k)}: [`);
                  v.forEach((item, i) => {
                    const itemComma = i < v.length - 1 ? ',' : '';
                    lines.push(`    ${formatValue(item)}${itemComma}`);
                  });
                  lines.push(`  ]${comma}`);
                } else {
                  lines.push(`  ${JSON.stringify(k)}: ${formatValue(v)}${comma}`);
                }
              });
              lines.push('}');
              return lines.join('\n') + '\n';
            };
            const outPath = resolve(__dirname, 'public/scene/spawns.json');
            fs.writeFileSync(outPath, formatTop(spawns));
            res.statusCode = 200;
            res.end('ok');
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    }
  }
});
