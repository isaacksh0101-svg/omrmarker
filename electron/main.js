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

const { app, BrowserWindow, dialog } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 4000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;

let serverProcess = null;
let mainWindow = null;

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
  serverProcess = spawn('node', [entry], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      PORT: String(PORT),
      // 설치 폴더는 쓰기 권한이 없을 수 있으니, 실제 시험지/응시 데이터는 사용자별
      // 데이터 폴더(Windows면 %APPDATA%\ScoreLab)에 저장한다.
      SCORELAB_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    // 창이 아직 떠 있는데 서버가 먼저 죽으면(예: 다른 프로그램이 4000번 포트를 막 차지함)
    // 이유를 알 수 없는 빈 화면만 보이게 되므로 바로 알려준다.
    if (mainWindow && code !== 0) {
      dialog.showErrorBox(
        'ScoreLab 서버 오류',
        '서버가 예기치 않게 종료됐습니다. 프로그램을 다시 시작해주세요.',
      );
      app.quit();
    }
  });
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
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'ScoreLab',
    backgroundColor: '#f7f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopServer() {
  if (!serverProcess) return;
  if (process.platform === 'win32') {
    // 자식이 셸(shell:true)로 떠서 taskkill로 트리 전체를 종료해야 실제 node 프로세스까지
    // 확실히 죽는다 - kill()만으로는 셸만 죽고 node는 포트를 문 채 남는 경우가 있었다.
    spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F']);
  } else {
    serverProcess.kill();
  }
  serverProcess = null;
}

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
      dialog.showErrorBox(
        'Node.js가 필요합니다',
        'ScoreLab을 실행하려면 Node.js 22 이상이 설치되어 있어야 합니다.\nhttps://nodejs.org 에서 설치한 뒤 다시 실행해주세요.',
      );
      app.quit();
      return;
    }

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
