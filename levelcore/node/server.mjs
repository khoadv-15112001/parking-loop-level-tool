// Server Node của level-tool-core: node levelcore/node/server.mjs
// Game: game/manifest.json của repo, hoặc đường dẫn trong LEVELCORE_GAME_MANIFEST. Biến môi trường <PREFIX>_* như server
// Python (DEV, DB, PORT, HOST, ADMINS, SESSION_SECRET…). Không có dependency; cần Node >= 22.13 (node:sqlite).
import path from 'node:path';
import { createApp } from './app.mjs';
import { REPO, settingsFromEnv } from './config.mjs';
import { loadGame } from './game.mjs';

const manifest = process.env.LEVELCORE_GAME_MANIFEST || path.join(REPO, 'game', 'manifest.json');
const game = await loadGame(manifest, REPO);
const s = settingsFromEnv(game.manifest);
const { server } = createApp(game, s);
server.listen(s.port, s.host, () => {
  console.log(`${s.toolName} (Node) chạy ở http://${s.host}:${s.port}/app/ — DB ${s.dbPath}${s.dev ? ' — DEV' : ''}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
