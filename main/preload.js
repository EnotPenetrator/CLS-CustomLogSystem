const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectLogFile: () => ipcRenderer.invoke('select-log-file'),
    startWatching: (logPath) => ipcRenderer.invoke('start-watching', logPath),
    stopWatching: () => ipcRenderer.invoke('stop-watching'),
    loadInitialLogs: (logPath) => ipcRenderer.invoke('load-initial-logs', logPath),
    getHints: () => ipcRenderer.invoke('get-hints'),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    saveFile: (content, defaultName) => ipcRenderer.invoke('save-file', content, defaultName),

    onNewLogs: (callback) => {
        ipcRenderer.on('new-logs', (event, logs) => callback(logs));
    },
    onLogError: (callback) => {
        ipcRenderer.on('log-error', (event, message) => callback(message));
    },
    onAutoDetectLog: (callback) => {
        ipcRenderer.on('auto-detect-log', (event, logPath) => callback(logPath));
    },
    onClearLogs: (callback) => {
        ipcRenderer.on('clear-logs', () => callback());
    },

    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    openConfigFolder: () => ipcRenderer.send('open-config-folder')
});