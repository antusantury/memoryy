import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

let serverProcess;
let splash;
let splashStartedAt = 0;
let splashReadyResolve;
const splashReady = new Promise((resolve) => { splashReadyResolve = resolve; });
let serverPort = 4173;
const copilotPath = process.env.COPILOT_BIN || join(process.env.HOME || "", ".local/bin/copilot");
const userBin = join(process.env.HOME || "", ".local/bin");
const homebrewBin = process.arch === "arm64" ? "/opt/homebrew/bin" : "/usr/local/bin";

function getInstallerLanguage() {
  if (process.platform !== "win32") return "";
  const languageFile = join(process.resourcesPath, "installer-language.txt");
  if (!existsSync(languageFile)) return "";
  try {
    const language = readFileSync(languageFile, "utf8").trim();
    return language === "en" || language === "ru" ? language : "";
  } catch {
    return "";
  }
}

function startServer() {
  serverProcess = spawn(process.execPath, [join(app.getAppPath(), "server.js")], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MEMORYY_ROOT: app.getAppPath(),
      MEMORYY_DATA_DIR: join(app.getPath("userData"), "data"),
      PATH: [userBin, homebrewBin, process.env.PATH || ""].filter(Boolean).join(":"),
      ...(existsSync(copilotPath) ? { COPILOT_BIN: copilotPath } : {}),
      PORT: String(serverPort)
    },
    stdio: "inherit"
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#111114",
    title: "Memoryy",
    icon: join(app.getAppPath(), "assets/memoryy-icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    splashReady.then(() => {
      const remaining = Math.max(0, 6000 - (Date.now() - splashStartedAt));
      setTimeout(() => {
        splash?.close();
        splash = null;
        window.show();
      }, remaining);
    });
  });
  const defaultLanguage = getInstallerLanguage();
  const languageQuery = defaultLanguage ? `?defaultLanguage=${defaultLanguage}` : "";
  window.loadURL(`http://127.0.0.1:${serverPort}/${languageQuery}`);
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function waitForServer() {
  return new Promise((resolve) => {
    const check = () => {
      const request = http.get(`http://127.0.0.1:${serverPort}/`, (response) => {
        response.resume();
        response.statusCode === 200 ? resolve() : setTimeout(check, 80);
      });
      request.on("error", () => setTimeout(check, 80));
      request.setTimeout(500, () => request.destroy());
    };
    check();
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock.setIcon(join(app.getAppPath(), "assets/memoryy-icon.png"));
  splash = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: { sandbox: true }
  });
  splash.once("ready-to-show", () => {
    splashStartedAt = Date.now();
    splash.show();
    splashReadyResolve();
  });
  splash.loadFile(join(app.getAppPath(), "splash.html"));
  findFreePort().then((port) => {
    serverPort = port;
    startServer();
    return waitForServer();
  }).then(() => createWindow()).catch((error) => {
    console.error(`Memoryy failed to start: ${error.message}`);
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
