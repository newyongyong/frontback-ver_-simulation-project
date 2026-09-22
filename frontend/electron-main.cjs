const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let api;
let web;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  const apiPath = path.join(root, "backend", "ProductionPlanningAPI.exe");
  api = spawn(apiPath, [], { windowsHide: true });
  const nextCli = path.join(__dirname, "node_modules", "next", "dist", "bin", "next");
  web = spawn(process.execPath, [nextCli, "start", "-p", "3000"], { cwd: __dirname, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true });
  await wait(2500);
  const window = new BrowserWindow({ width: 1440, height: 900, webPreferences: { contextIsolation: true } });
  window.loadURL("http://127.0.0.1:3000").catch((error) => dialog.showErrorBox("실행 오류", error.message));
}

app.whenReady().then(start);
app.on("window-all-closed", () => app.quit());
app.on("quit", () => { api?.kill(); web?.kill(); });
