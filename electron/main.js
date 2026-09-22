// ScoreLab을 감싸는 Electron 셸. 서버/클라이언트 코드는 절대 건드리지 않고, 그대로
// 자식 프로세스로 띄운 뒤 그 결과를 앱 창 하나에 보여주기만 한다.
//
// 왜 서버를 Electron 안에서 직접 require하지 않고 별도 자식 프로세스로 띄우나:
// 서버가 @napi-rs/canvas 같은 네이티브 모듈과 node:sqlite(Node 22.5+ 내장, 아직 실험적)를
// 쓰는데, 이걸 Electron 번들 Node 버전이 지금 확실히 지원하는지 보장할 수 없다. 그래서
// 시스템에 설치된 진짜 Node.js로 서버를 그대로 실행하는 지금 방식(실행하기.bat과 동일한
// 실행 방식)을 유지한다 - 대신 터미널 창 대신 진짜 앱 창을 띄우고, 설치 프로그램(.exe)으로
// 배포할 수 있게 감싸는 것까지만 이 셸이 맡는다.
// (Node.js 설치가 아예 필요 없는 완전 독립 실행형으로 가려면, 나중에 실제 portable
// node.exe를 리소스로 함께 배포하고 그걸 spawn하도록 바꾸면 된다.)
//
// AI API 키 같은 설정은 여기(Electron 셸)가 아니라 ScoreLab 앱 자체의 환경설정 화면에서
// 입력받아 서버가 dataDir/settings.json에 저장한다(server/src/services/appSettings.js) -
// 설정 창이 두 군데로 갈라지면 헷갈리므로, 이 셸은 창을 띄우고 서버를 관리하는 역할만 한다.

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = 4000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/';

let serverProcess = null;
let mainWindow = null;
let stoppingServer = false;
let recentServerOutput = [];
let activeDataDir = null;
const setupToken = crypto.randomBytes(32).toString('base64url');

function storageLocationConfigPath() {
  return path.join(app.getPath('userData'), 'storage-location.json');
}

function defaultDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function readConfiguredDataDir() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storageLocationConfigPath(), 'utf8'));
    if (typeof parsed.dataDir === 'string' && path.isAbsolute(parsed.dataDir)) {
      return path.normalize(parsed.dataDir);
    }
  } catch {
    // 첫 실행 또는 손상된 설정이면 아래 첫 실행 선택 절차로 복구한다.
  }
  return null;
}

function readStorageConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storageLocationConfigPath(), 'utf8'));
    return {
      dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : null,
      previousDataDirs: Array.isArray(parsed.previousDataDirs) ? parsed.previousDataDirs : [],
    };
  } catch {
    return { dataDir: null, previousDataDirs: [] };
  }
}

function saveConfiguredDataDir(dataDir, previousDataDirs = readStorageConfig().previousDataDirs) {
  const configPath = storageLocationConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ dataDir, previousDataDirs }, null, 2), 'utf8');
  fs.renameSync(temporaryPath, configPath);
}

async function selectInitialDataDir() {
  const configured = readConfiguredDataDir();
  if (configured) return configured;

  // 이전 버전에서 이미 기본 위치에 데이터를 만든 사용자는 업그레이드 후 갑자기 빈 폴더를
  // 고르게 하지 않는다. 기존 위치를 자동 등록해 시험·학생 데이터가 그대로 이어지게 한다.
  const previousDefault = defaultDataDir();
  if (directoryHasContents(previousDefault)) {
    saveConfiguredDataDir(previousDefault);
    return previousDefault;
  }

  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: 'ScoreLab 데이터 저장 위치',
    message: '시험지와 학생 학습 데이터를 저장할 위치를 선택해주세요.',
    detail: '선택한 폴더 안에 ScoreLab 전용 폴더가 만들어집니다. 학교에서 관리하는 저장장치를 권장합니다.',
    buttons: ['저장 폴더 선택', '기본 위치 사용'],
    defaultId: 0,
    cancelId: 1,
  });

  let dataDir = defaultDataDir();
  if (choice === 0) {
    const selected = await dialog.showOpenDialog({
      title: 'ScoreLab 데이터를 저장할 상위 폴더 선택',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!selected.canceled && selected.filePaths[0]) {
      dataDir = path.join(selected.filePaths[0], 'ScoreLab');
    }
  }
  fs.mkdirSync(dataDir, { recursive: true });
  saveConfiguredDataDir(dataDir);
  return dataDir;
}

function serverLogPath() {
  return path.join(activeDataDir || defaultDataDir(), 'logs', 'server.log');
}

function recordServerOutput(chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/).filter(Boolean);
  recentServerOutput = recentServerOutput.concat(lines).slice(-20);
  try {
    const logPath = serverLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${text}`);
  } catch {
    // 로그 저장 실패가 본 서버 실행까지 막지는 않도록 한다.
  }
}

function serverEntryPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'server', 'src', 'index.js')
    : path.join(__dirname, '..', 'server', 'src', 'index.js');
}

function checkNodeAvailable() {
  const result = spawnSync('node', ['--version'], { shell: process.platform === 'win32' });
  return result.status === 0;
}

function startServer() {
  const entry = serverEntryPath();
  stoppingServer = false;
  recentServerOutput = [];
  serverProcess = spawn('node', [entry], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      PORT: String(PORT),
      // 설치 폴더는 쓰기 권한이 없을 수 있으니, 실제 시험지/응시 데이터는 사용자별
      // 데이터 폴더(Windows면 %APPDATA%\ScoreLab)에 저장한다.
      SCORELAB_DATA_DIR: activeDataDir || defaultDataDir(),
      // 최초 비밀번호 설정은 이 Electron 실행이 만든 일회용 토큰이 있어야만 가능하다.
      SCORELAB_SETUP_TOKEN: setupToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  serverProcess.stdout.on('data', recordServerOutput);
  serverProcess.stderr.on('data', recordServerOutput);

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    // 창이 아직 떠 있는데 서버가 먼저 죽으면(예: 다른 프로그램이 4000번 포트를 막 차지함)
    // 이유를 알 수 없는 빈 화면만 보이게 되므로 바로 알려준다.
    if (!stoppingServer && mainWindow && code !== 0) {
      const detail = recentServerOutput.length > 0
        ? recentServerOutput.join('\n')
        : '서버가 별도의 오류 내용을 남기지 않았습니다.';
      dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        title: 'ScoreLab 서버 오류',
        message: '서버가 예기치 않게 종료됐습니다.',
        detail: `${detail}\n\n전체 로그: ${serverLogPath()}`,
        buttons: ['닫기'],
      });
      app.quit();
    }
  });
}

function stopServer() {
  if (!serverProcess) return;
  stoppingServer = true;
  if (process.platform === 'win32') {
    // 자식이 셸(shell:true)로 떠서 taskkill로 트리 전체를 종료해야 실제 node 프로세스까지
    // 확실히 죽는다 - kill()만으로는 셸만 죽고 node는 포트를 문 채 남는 경우가 있었다.
    spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F']);
  } else {
    serverProcess.kill();
  }
  serverProcess = null;
}

function waitForServer(deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('서버 시작 대기 시간 초과'));
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

function createWindow() {
  // autoHideMenuBar는 Alt 키를 누르면 메뉴가 다시 나타난다. 설정이 웹 환경설정으로
  // 통합됐으므로 Electron의 기본 애플리케이션 메뉴 자체를 완전히 제거한다.
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'ScoreLab',
    backgroundColor: '#f7f8fb',
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  // 환경설정 화면의 "API 키 발급받기" 같은 외부 링크(target=_blank)는 Electron 창을 새로
  // 띄우는 대신 시스템 기본 브라우저로 열어야 한다 - 기본 동작(거부)로 두면 그냥 아무 일도
  // 안 일어난다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function directoryHasContents(directory) {
  return fs.existsSync(directory) && fs.readdirSync(directory).length > 0;
}

ipcMain.handle('storage:get-location', () => {
  const config = readStorageConfig();
  const previousDataDirs = config.previousDataDirs
    .filter((item) => item && typeof item.path === 'string' && !item.acknowledged)
    .map((item) => ({ ...item, exists: fs.existsSync(item.path) }));
  return { dataDir: activeDataDir, previousDataDirs };
});

ipcMain.handle('storage:acknowledge-previous-location', (_event, previousPath) => {
  const config = readStorageConfig();
  const previousDataDirs = config.previousDataDirs.map((item) =>
    item?.path === previousPath ? { ...item, acknowledged: true, acknowledgedAt: new Date().toISOString() } : item,
  );
  saveConfiguredDataDir(activeDataDir, previousDataDirs);
  return { ok: true };
});

ipcMain.handle('storage:change-location', async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: 'ScoreLab 데이터를 저장할 새 상위 폴더 선택',
    defaultPath: activeDataDir ? path.dirname(activeDataDir) : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return { changed: false };

  const nextDataDir = path.normalize(path.join(selected.filePaths[0], 'ScoreLab'));
  if (path.resolve(nextDataDir) === path.resolve(activeDataDir)) return { changed: false };
  if (directoryHasContents(nextDataDir)) {
    throw new Error('선택한 위치의 ScoreLab 폴더가 비어 있지 않습니다. 다른 폴더를 선택해주세요.');
  }

  const confirmation = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    title: '데이터 저장 위치 변경',
    message: '현재 데이터를 새 위치로 복사하고 ScoreLab을 다시 시작할까요?',
    detail: `새 위치: ${nextDataDir}\n\n안전을 위해 기존 위치의 원본은 자동 삭제하지 않습니다. 새 위치에서 정상 동작하는지 확인한 뒤 기존 폴더를 직접 삭제해주세요.`,
    buttons: ['복사 후 다시 시작', '취소'],
    defaultId: 0,
    cancelId: 1,
  });
  if (confirmation !== 0) return { changed: false };

  stopServer();
  fs.mkdirSync(nextDataDir, { recursive: true });
  if (fs.existsSync(activeDataDir)) {
    fs.cpSync(activeDataDir, nextDataDir, { recursive: true, errorOnExist: true, force: false });
  }
  const previousDataDir = activeDataDir;
  const storageConfig = readStorageConfig();
  const previousDataDirs = [
    ...storageConfig.previousDataDirs,
    { path: previousDataDir, changedAt: new Date().toISOString(), acknowledged: false },
  ];
  saveConfiguredDataDir(nextDataDir, previousDataDirs);
  activeDataDir = nextDataDir;

  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 300);
  return { changed: true, dataDir: nextDataDir, previousDataDir };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (!checkNodeAvailable()) {
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Node.js가 필요합니다',
        message: 'ScoreLab을 실행하려면 Node.js 22 이상이 설치되어 있어야 합니다.',
        detail: '아래 버튼으로 다운로드 페이지를 열 수 있습니다. 설치 후 ScoreLab을 다시 실행해주세요.',
        buttons: ['Node.js 다운로드 페이지 열기', '닫기'],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice === 0) shell.openExternal(NODE_DOWNLOAD_URL);
      app.quit();
      return;
    }

    activeDataDir = await selectInitialDataDir();
    startServer();
    try {
      await waitForServer(Date.now() + 60_000);
      createWindow();
    } catch {
      dialog.showErrorBox('ScoreLab 실행 실패', '서버가 60초 안에 시작되지 않았습니다. 다시 실행해주세요.');
      stopServer();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', stopServer);
}
