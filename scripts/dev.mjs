import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../envConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const viteArgs = process.argv.slice(2);

const children = [];
let shuttingDown = false;

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: "inherit",
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const reason = signal || code;
    console.error(`${name} exited with ${reason ?? 0}`);
    shutdown(code || 1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) {
      child.kill();
    }
  });
  process.exitCode = code;
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    }

    tryConnect();
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await loadLocalEnv({ projectRoot });

start("backend", process.execPath, ["server.js"]);

try {
  await waitForPort(Number(process.env.PORT) || 3000);
  start("vite", process.execPath, [viteBin, ...viteArgs]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
