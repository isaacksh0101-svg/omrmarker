const { contextBridge, ipcRenderer } = require('electron');

// 렌더러에는 파일시스템 권한을 직접 노출하지 않고 저장 위치 확인·변경용 IPC만 제공한다.
contextBridge.exposeInMainWorld('scorelabDesktop', {
  getStorageLocation: () => ipcRenderer.invoke('storage:get-location'),
  changeStorageLocation: () => ipcRenderer.invoke('storage:change-location'),
  acknowledgePreviousStorageLocation: (previousPath) =>
    ipcRenderer.invoke('storage:acknowledge-previous-location', previousPath),
});
