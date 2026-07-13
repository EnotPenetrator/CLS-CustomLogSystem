const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'cls-data'));

app.on('window-all-closed', () => {
    app.quit();
});

const { LogParser } = require('./logParser');
const { SpamFilter } = require('./spamFilter');

let mainWindow = null;
let isQuitting = false;
let hints = [];
let autoDetectTimer = null;
let lastSize = 0;
let lastFile = null;
let spamFilterInstance = null;

let serverLogPath = null;
let serverAutoDetectTimer = null;
let serverLastSize = 0;
let serverLastFile = null;
let serverWasModified = false;
let serverLastLineCount = 0;
let serverCurrentLogPath = null;

// ==================== Config ====================
const configDir = path.join(path.dirname(app.getPath('exe')), 'config');

function ensureConfigFiles() {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    const hintsPath = path.join(configDir, 'CustomHints.xml');
    if (!fs.existsSync(hintsPath)) {
        const defaultHints = `<?xml version="1.0" encoding="utf-8"?>
<CustomHints>
    <Hint Key="recalculatecell" Value="Game is recalculating terrain cells. Normal behavior." />
</CustomHints>`;
        fs.writeFileSync(hintsPath, defaultHints, 'utf-8');
    }

    const spamPath = path.join(configDir, 'SpamFilters.xml');
    if (!fs.existsSync(spamPath)) {
        const defaultSpam = `<?xml version="1.0" encoding="utf-8"?>
<SpamFilters>
    <Pattern Value="RecalculateCell" Mode="ReplaceNumbers" />
</SpamFilters>`;
        fs.writeFileSync(spamPath, defaultSpam, 'utf-8');
    }

    const excludePath = path.join(configDir, 'ExcludeFilters.xml');
    if (!fs.existsSync(excludePath)) {
        const defaultExclude = `<?xml version="1.0" encoding="utf-8"?>
<ExcludeFilters>
</ExcludeFilters>`;
        fs.writeFileSync(excludePath, defaultExclude, 'utf-8');
    }

    const modTagsPath = path.join(configDir, 'ModTags.xml');
    if (!fs.existsSync(modTagsPath)) {
        const defaultModTags = `<?xml version="1.0" encoding="utf-8"?>
<ModTags>
</ModTags>`;
        fs.writeFileSync(modTagsPath, defaultModTags, 'utf-8');
    }

    const settingsPath = path.join(configDir, 'Settings.xml');
    if (!fs.existsSync(settingsPath)) {
        const defaultSettings = `<?xml version="1.0" encoding="utf-8"?>
<Settings>
    <ServerLogPath></ServerLogPath>
</Settings>`;
        fs.writeFileSync(settingsPath, defaultSettings, 'utf-8');
    }

}

function loadCustomHints() {
    const hintsPath = path.join(configDir, 'CustomHints.xml');
    try {
        if (fs.existsSync(hintsPath)) {
            const content = fs.readFileSync(hintsPath, 'utf-8');
            const hintMatches = content.matchAll(/<Hint\s+Key="([^"]+)"\s+Value="([^"]+)"\s*\/>/g);
            for (const match of hintMatches) {
                hints.push({ key: match[1], value: match[2] });
            }
        }
    } catch (e) { }
}

function loadSpamFilters() {
    const spamPath = path.join(configDir, 'SpamFilters.xml');
    const rules = [];
    try {
        if (fs.existsSync(spamPath)) {
            const content = fs.readFileSync(spamPath, 'utf-8');
            const patternMatches = content.matchAll(/<Pattern\s+Value="([^"]+)"\s+Mode="([^"]+)"[^>]*\/>/g);
            for (const match of patternMatches) {
                const rule = { value: match[1], mode: match[2] };
                const lengthMatch = match[0].match(/Length="(\d+)"/);
                if (lengthMatch) rule.length = parseInt(lengthMatch[1]);
                const sepMatch = match[0].match(/Separator="([^"]+)"/);
                if (sepMatch) rule.separator = sepMatch[1];
                rules.push(rule);
            }
        }
    } catch (e) { }
    return rules;
}

function loadExcludeFilters() {
    const excludePath = path.join(configDir, 'ExcludeFilters.xml');
    const filters = [];
    try {
        if (fs.existsSync(excludePath)) {
            const content = fs.readFileSync(excludePath, 'utf-8');
            const filterMatches = content.matchAll(/<Filter\s+Value="([^"]+)"\s*\/>/g);
            for (const match of filterMatches) {
                filters.push(match[1]);
            }
        }
    } catch (e) { }
    return filters;
}

function loadModTags() {
    const modTagsPath = path.join(configDir, 'ModTags.xml');
    const tags = [];
    try {
        if (fs.existsSync(modTagsPath)) {
            const content = fs.readFileSync(modTagsPath, 'utf-8');
            const tagMatches = content.matchAll(/<Tag\s+Value="([^"]+)"\s*\/>/g);
            for (const match of tagMatches) {
                tags.push(match[1]);
            }
        }
    } catch (e) { }
    return tags;
}

function loadSetting(key) {
    const settingsPath = path.join(configDir, 'Settings.xml');
    try {
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            const match = content.match(new RegExp(`<${key}>(.*?)</${key}>`));
            return match ? match[1] : '';
        }
    } catch (e) { }
    return '';
}

function saveSetting(key, value) {
    const settingsPath = path.join(configDir, 'Settings.xml');
    try {
        let content = fs.readFileSync(settingsPath, 'utf-8');
        if (content.includes(`<${key}>`)) {
            content = content.replace(new RegExp(`<${key}>.*?</${key}>`), `<${key}>${value}</${key}>`);
        } else {
            content = content.replace('</Settings>', `    <${key}>${value}</${key}>\n</Settings>`);
        }
        fs.writeFileSync(settingsPath, content, 'utf-8');
    } catch (e) { }
}

// ==================== Window ====================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        title: 'CLS Logger',
        icon: path.join(path.dirname(app.getPath('exe')), 'build', 'icon.ico'),
        frame: false,
        transparent: false,
        backgroundColor: '#1a1a1a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setBounds({ width: 1400, height: 900 });
        mainWindow.center();
    });

    mainWindow.on('close', () => {
        if (autoDetectTimer) {
            clearInterval(autoDetectTimer);
        }
        if (serverAutoDetectTimer) {
            clearInterval(serverAutoDetectTimer);
        }
        mainWindow = null;
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ==================== Auto-detect log ====================
function getLogFiles() {
    const appDataPath = path.join(process.env.APPDATA, '7DaysToDie', 'logs');
    try {
        if (fs.existsSync(appDataPath)) {
            return fs.readdirSync(appDataPath)
                .filter(f => f.startsWith('output_log_client_'))
                .sort()
                .reverse();
        }
    } catch (e) { }
    return [];
}

function getLogFilePath(filename) {
    return path.join(process.env.APPDATA, '7DaysToDie', 'logs', filename);
}

function mergeMultilineLogs(lines) {
    const merged = [];
    const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

    for (let i = 0; i < lines.length; i++) {
        if (timestampRegex.test(lines[i])) {
            merged.push(lines[i]);
        } else if (merged.length > 0) {
            merged[merged.length - 1] += '\n' + lines[i];
        }
    }
    return merged;
}

function startAutoDetect() {
    lastSize = 0;
    lastFile = null;
    let wasModified = false;
    let lastLineCount = 0;

    autoDetectTimer = setInterval(() => {
        const files = getLogFiles();
        if (files.length === 0) return;

        const latestFile = getLogFilePath(files[0]);

        try {
            const stats = fs.statSync(latestFile);

            // New file detected
            if (latestFile !== lastFile) {
                lastFile = latestFile;
                lastSize = stats.size;
                wasModified = false;
                lastLineCount = 0;
                return;
            }

            // File changed size — game is writing
            if (stats.size !== lastSize) {
                if (!wasModified) {
                    // First change detected — load full file
                    wasModified = true;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('clear-logs');
                        mainWindow.webContents.send('auto-detect-log', latestFile);
                    }
                    const content = fs.readFileSync(latestFile, 'utf-8');
                    const rawLines = content.split('\n').filter(l => l.trim());
                    const lines = mergeMultilineLogs(rawLines);
                    const parsed = [];
                    for (const line of lines) {
                        // Auto-detect mods from Loaded Mod lines
                        if (line.includes('Loaded Mod:')) {
                            const modMatch = line.match(/Loaded Mod: (.+?) \(/);
                            if (modMatch && LogParser.knownMods && !LogParser.knownMods.includes(modMatch[1])) {
                                LogParser.knownMods.push(modMatch[1]);
                            }
                        }
                        const entry = LogParser.parse(line, hints);
                        if (entry) parsed.push(entry);
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('new-logs', parsed);
                    }
                    lastLineCount = lines.length;
                } else if (stats.size > lastSize) {
                    // Read entire file to avoid splitting multiline entries
                    const content = fs.readFileSync(latestFile, 'utf-8');
                    const rawLines = content.split('\n').filter(l => l.trim());
                    const lines = mergeMultilineLogs(rawLines);

                    const newLines = lines.slice(lastLineCount);
                    if (newLines.length > 0) {
                        const parsed = [];
                        for (const line of newLines) {
                            // Auto-detect mods from Loaded Mod lines
                            if (line.includes('Loaded Mod:')) {
                                const modMatch = line.match(/Loaded Mod: (.+?) \(/);
                                if (modMatch && LogParser.knownMods && !LogParser.knownMods.includes(modMatch[1])) {
                                    LogParser.knownMods.push(modMatch[1]);
                                }
                            }
                            const entry = LogParser.parse(line, hints);
                            if (entry) parsed.push(entry);
                        }
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('new-logs', parsed);
                        }
                    }
                    lastLineCount = lines.length;
                }
                lastSize = stats.size;
            }
        } catch (e) { }
    }, 1000);
}

function getServerLogFiles() {
    if (fs.existsSync(serverLogPath)) {
        const files = fs.readdirSync(serverLogPath)
            .filter(f => f.startsWith('output_log_dedi_'))
            .sort()
            .reverse()
            .map(f => path.join(serverLogPath, f));
        if (files.length > 0) return files;
    }

    const dataPath = path.join(serverLogPath, '7DaysToDieServer_Data');
    try {
        if (fs.existsSync(dataPath)) {
            return fs.readdirSync(dataPath)
                .filter(f => f.startsWith('output_log_dedi_'))
                .sort()
                .reverse()
                .map(f => path.join(dataPath, f));
        }
    } catch (e) { }
    return [];
}

function startServerAutoDetect() {
    serverLastSize = 0;
    serverLastFile = null;
    let wasModified = false;
    let lastLineCount = 0;

    serverAutoDetectTimer = setInterval(() => {
        if (!serverLogPath) return;
        const files = getServerLogFiles();
        if (files.length === 0) return;

        const latestFile = files[0];

        try {
            const stats = fs.statSync(latestFile);

            // New file detected
            if (latestFile !== serverLastFile) {
                serverLastFile = latestFile;
                serverLastSize = stats.size;
                wasModified = false;
                lastLineCount = 0;
                return;
            }

            // File changed size — server is writing
            if (stats.size !== serverLastSize) {
                if (!wasModified) {
                    // First change detected — load full file
                    wasModified = true;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server-clear-logs');
                        mainWindow.webContents.send('server-auto-detect-log', latestFile);
                    }
                    const content = fs.readFileSync(latestFile, 'utf-8');
                    const rawLines = content.split('\n').filter(l => l.trim());
                    const lines = mergeMultilineLogs(rawLines);
                    const parsed = [];
                    for (const line of lines) {
                        const entry = LogParser.parse(line, hints);
                        if (entry) parsed.push(entry);
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('server-new-logs', parsed);
                    }
                    lastLineCount = lines.length;
                } else if (stats.size > serverLastSize) {
                    const content = fs.readFileSync(latestFile, 'utf-8');
                    const rawLines = content.split('\n').filter(l => l.trim());
                    const lines = mergeMultilineLogs(rawLines);

                    const newLines = lines.slice(lastLineCount);
                    if (newLines.length > 0) {
                        const parsed = [];
                        for (const line of newLines) {
                            const entry = LogParser.parse(line, hints);
                            if (entry) parsed.push(entry);
                        }
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('server-new-logs', parsed);
                        }
                    }
                    lastLineCount = lines.length;
                }
                serverLastSize = stats.size;
            }
        } catch (e) { }
    }, 1000);
}

// ==================== Window Controls ====================
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
    if (autoDetectTimer) clearInterval(autoDetectTimer);
    if (mainWindow) mainWindow.close();
    app.quit();
});

// ==================== Config IPC ====================
ipcMain.on('open-config-folder', () => {
    shell.openPath(configDir);
});

// ==================== IPC Handlers ====================

ipcMain.handle('select-server-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select 7 Days to Die Server folder',
        properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const serverPath = result.filePaths[0];
        saveSetting('ServerLogPath', serverPath);
        return serverPath;
    }
    return null;
});

ipcMain.handle('get-server-path', () => {
    const savedPath = loadSetting('ServerLogPath');
    return savedPath || null;
});

ipcMain.handle('select-log-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select 7 Days to Die log file',
        filters: [
            { name: 'Log Files', extensions: ['txt', 'log'] }
        ],
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('stop-watching', () => {
    return true;
});

ipcMain.handle('load-initial-logs', async (event, logPath) => {
    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const rawLines = content.split('\n').filter(l => l.trim());
        const lines = mergeMultilineLogs(rawLines);
        const parsed = [];
        for (const line of lines) {
            const entry = LogParser.parse(line, hints);
            if (entry) parsed.push(entry);
        }
        return parsed;
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('get-hints', () => {
    return hints;
});

ipcMain.handle('get-versions', () => {
    return {
        gameVersion: LogParser.gameVersion,
        engineVersion: LogParser.engineVersion
    };
});

ipcMain.handle('save-file', async (event, content, defaultName) => {
    const defaultDir = path.join(path.dirname(app.getPath('exe')), 'exports');
    if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
    }

    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Logs',
        defaultPath: path.join(defaultDir, defaultName),
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'Excel', extensions: ['xls'] },
            { name: 'XML', extensions: ['xml'] }
        ]
    });
    if (!result.canceled) {
        fs.writeFileSync(result.filePath, content, 'utf-8');
        return true;
    }
    return false;
});

// ==================== App Lifecycle ====================
app.whenReady().then(() => {
    LogParser.customModTags = loadModTags();
    LogParser.knownMods = [];
    ensureConfigFiles();
    loadCustomHints();

    spamFilterInstance = new SpamFilter();
    spamFilterInstance.loadRules(loadSpamFilters());
    LogParser.spamFilter = spamFilterInstance;

    LogParser.excludeFilters = loadExcludeFilters();

    createWindow();
    startAutoDetect();

    // Load server path
    const savedServerPath = loadSetting('ServerLogPath');
    if (savedServerPath) {
        serverLogPath = savedServerPath;
        startServerAutoDetect();
    }
});

ipcMain.on('update-known-mods', (event, mods) => {
    console.log('MAIN RECEIVED MODS:', mods);
    LogParser.knownMods = mods;
});