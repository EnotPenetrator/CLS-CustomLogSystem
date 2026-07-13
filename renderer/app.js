// ===========================================
// CLS Logger - Electron Renderer Process
// ===========================================

let allLogs = [];
let externalLogs = [];
let customHints = [];
let knownMods = [];

let currentFilter = sessionStorage.getItem('cls_filter') || 'all';
let currentSource = sessionStorage.getItem('cls_source') || 'all';
let savedSearch = sessionStorage.getItem('cls_search') || '';
let currentTab = sessionStorage.getItem('cls_tab') || 'live';
let previousFilter = currentFilter;

let lastLogCount = 0;

let deletedKeys = JSON.parse(sessionStorage.getItem('cls_deleted') || '[]');
let favoritesLive = JSON.parse(sessionStorage.getItem('cls_favorites_live') || '[]');
let favoritesExternal = JSON.parse(sessionStorage.getItem('cls_favorites_external') || '[]');

let externalGameVersion = 'N/A';
let externalEngineVersion = 'N/A';
let externalFilePath = 'No file loaded';
let serverLogs = [];
let serverGameVersion = 'N/A';
let serverEngineVersion = 'N/A';
let serverLogPath = 'Not configured';
let knownServerMods = [];
let favoritesServer = JSON.parse(sessionStorage.getItem('cls_favorites_server') || '[]');
let liveLogPath = 'Waiting for game...';
let liveGameVersion = 'Unknown';
let liveEngineVersion = 'Unknown';

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    initDropdowns();
    updateButtons();
    restoreTab();

    window.electronAPI.getVersions().then(versions => {
        if (versions) {
            liveGameVersion = versions.gameVersion || 'Unknown';
            liveEngineVersion = versions.engineVersion || 'Unknown';
            if (currentTab === 'live') {
                document.getElementById('gameVersion').textContent = liveGameVersion;
                document.getElementById('engineVersion').textContent = liveEngineVersion;
            }
        }
    });

    window.electronAPI.getHints().then(hints => {
        customHints = hints;
    });

    window.electronAPI.onAutoDetectLog((logPath) => {
        liveLogPath = logPath;
        if (currentTab === 'live') {
            document.getElementById('logFilePath').textContent = logPath;
        }
        document.getElementById('statusIndicator').textContent = '● LIVE';
        document.getElementById('statusIndicator').className = 'status watching';
    });

    window.electronAPI.onNewLogs((newLogs) => {
        const filtered = newLogs.filter(l => l !== null);
        if (filtered.length > 0) {
            allLogs.push(...filtered);

            if (allLogs.length > 50000) {
                allLogs = allLogs.slice(-50000);
            }

            extractKnownMods(filtered);

            window.electronAPI.getVersions().then(versions => {
                if (versions) {
                    liveGameVersion = versions.gameVersion || 'Unknown';
                    liveEngineVersion = versions.engineVersion || 'Unknown';
                    if (currentTab === 'live') {
                        document.getElementById('gameVersion').textContent = liveGameVersion;
                        document.getElementById('engineVersion').textContent = liveEngineVersion;
                    }
                }
            });

            if (currentTab === 'live') {
                renderLogs();
                updateStats();
            }
        }
    });

    window.electronAPI.onLogError((message) => {
        console.error('Log watcher error:', message);
        document.getElementById('statusIndicator').textContent = '● ERROR';
        document.getElementById('statusIndicator').className = 'status error';
    });

    window.electronAPI.onClearLogs(() => {
        allLogs = [];
        knownMods = [];
        lastLogCount = 0;

        const menu = document.getElementById('dropdownMenu');
        if (menu) {
            const allLinks = menu.querySelectorAll('a');
            allLinks.forEach(a => {
                const onclick = a.getAttribute('onclick') || '';
                if (onclick.includes('filterBySource') &&
                    onclick !== "event.preventDefault();filterBySource('all')" &&
                    onclick !== "event.preventDefault();filterBySource('game')" &&
                    onclick !== "event.preventDefault();filterBySource('mod')") {
                    a.remove();
                }
            });
        }
        const container = document.getElementById('logs');
        if (container) {
            container.innerHTML = `<div class="empty-state">
            <div style="font-size:48px;margin-bottom:20px;">📡</div>
            <p>New game session detected...</p>
            <p style="font-size:12px;color:#666;margin-top:10px;">Loading new logs...</p>
        </div>`;
        }
        document.getElementById('totalCount').textContent = '0';
        updateStats();
    });   

    // Server log handlers (после onClearLogs)
    window.electronAPI.onServerNewLogs((newLogs) => {
        const filtered = newLogs.filter(l => l !== null);
        if (filtered.length > 0) {
            serverLogs.push(...filtered);
            if (serverLogs.length > 50000) {
                serverLogs = serverLogs.slice(-50000);
            }
            if (currentTab === 'server') {
                renderLogs();
                updateStats();
            }
        }
    });

    window.electronAPI.onServerClearLogs(() => {
        serverLogs = [];
        knownServerMods = [];
        lastLogCount = 0;
        const container = document.getElementById('logs');
        if (container) {
            container.innerHTML = `<div class="empty-state">
                <div style="font-size:48px;margin-bottom:20px;">🖥️</div>
                <p>New server session detected...</p>
                <p style="font-size:12px;color:#666;margin-top:10px;">Loading server logs...</p>
            </div>`;
        }
        document.getElementById('totalCount').textContent = '0';
        updateStats();
    });

    window.electronAPI.onServerAutoDetectLog((logPath) => {
        serverLogPath = logPath;
        if (currentTab === 'server') {
            document.getElementById('logFilePath').textContent = logPath;
        }
        document.getElementById('statusIndicator').textContent = '● LIVE';
        document.getElementById('statusIndicator').className = 'status watching';
    });

    window.electronAPI.getServerPath().then(savedPath => {
        if (savedPath) {
            serverLogPath = savedPath;
        }
    });

    const container = document.getElementById('logs');
    if (container) {
        container.addEventListener('scroll', () => {
            const key = `cls_scroll_${currentTab}_${currentFilter}_${currentSource}`;
            sessionStorage.setItem(key, container.scrollTop);
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentTab !== 'external') switchTab('external');
            const file = e.dataTransfer.files[0];
            if (file) loadExternalFile(file);
        });
    }

    window.addEventListener('beforeunload', () => {
        sessionStorage.setItem('cls_filter', currentFilter);
        sessionStorage.setItem('cls_source', currentSource);
        sessionStorage.setItem('cls_tab', currentTab);
        const searchInput = document.getElementById('search');
        if (searchInput) {
            sessionStorage.setItem('cls_search', searchInput.value);
        }
    });

    updateFavCount();
    document.getElementById('generatedTime').textContent = new Date().toLocaleString();
});

// ==================== External Logs ====================
function loadExternalFile(file) {
    if (!file) return;

    externalFilePath = file.name || file.path || 'Loaded file';

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;

        externalGameVersion = 'N/A';
        externalEngineVersion = 'N/A';

        const lines = content.split('\n');
        for (const line of lines) {
            if (line.includes('Initialize engine version:')) {
                const idx = line.indexOf('Initialize engine version:');
                if (idx >= 0) {
                    externalEngineVersion = line.substring(idx + 'Initialize engine version:'.length).trim();
                }
            }
            if (line.includes('Version:') && line.includes('Compatibility')) {
                const verMatch = line.match(/Version: (.+?),/);
                if (verMatch) {
                    externalGameVersion = verMatch[1].trim();
                }
            }
        }

        if (content.trim().startsWith('<?xml') && content.includes('<logs>')) {
            parseXmlLogs(content);
        } else if (content.includes('<table') && content.includes('<tr><th>Timestamp</th>')) {
            parseXlsLogs(content);
        } else {
            parsePlainTextLogs(content);
        }
        renderExternalLogs();
        if (currentTab === 'external') {
            updateStats();
            extractModsFromExternalLogs();
        }
    };
    reader.readAsText(file);
}

function parsePlainTextLogs(content) {
    const lines = content.split('\n').filter(l => l.trim());
    const merged = mergeMultilineLogs(lines);
    externalLogs = [];
    for (const line of merged) {
        const parsed = parseLogLine(line);
        if (parsed) externalLogs.push(parsed);
    }
}

function parseXmlLogs(xmlString) {
    externalLogs = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const logNodes = doc.querySelectorAll('log');

    for (const node of logNodes) {
        externalLogs.push({
            timestamp: node.querySelector('timestamp')?.textContent || '',
            type: node.querySelector('type')?.textContent || 'INFO',
            source: node.querySelector('source')?.textContent === 'GAME' ? 'GAME' : 'MOD',
            message: node.querySelector('message')?.textContent || '',
            blockName: node.querySelector('source')?.textContent !== 'GAME' ? node.querySelector('source')?.textContent : null,
            hint: node.querySelector('hint')?.textContent || ''
        });
    }
}

function parseXlsLogs(htmlString) {
    externalLogs = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const rows = doc.querySelectorAll('table tr');

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('td');
        if (cells.length >= 4) {
            externalLogs.push({
                timestamp: cells[0]?.textContent?.trim() || '',
                type: cells[1]?.textContent?.trim() || 'INFO',
                source: cells[2]?.textContent?.trim() === 'GAME' ? 'GAME' : 'MOD',
                message: cells[3]?.textContent?.trim() || '',
                blockName: cells[2]?.textContent?.trim() !== 'GAME' ? cells[2]?.textContent?.trim() : null,
                hint: cells[4]?.textContent?.trim() || ''
            });
        }
    }
}

function parseLogLine(line) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line)) return null;
    if (line.includes('CBDS')) console.log('PARSING CBDS LINE:', line.substring(0, 80));
    const type = detectLogType(line);
    const { source, modName } = detectLogSource(line);
    return {
        timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Math.floor(Math.random() * 1000)).padStart(3, '0'),
        type,
        message: line,
        source,
        blockName: modName || null,
        hint: generateHint(line, type)
    };
}

// ==================== Filtering and Rendering ====================
function getActiveLogs() {
    if (currentTab === 'live') return allLogs;
    if (currentTab === 'server') return serverLogs;
    return externalLogs;
}

function filterLogsArray(logs) {
    let filtered = [];
    const search = savedSearch.toLowerCase();

    for (const log of logs) {
        let show = true;

        if (currentFilter === 'favorites') {
            const key = log.timestamp + '|' + log.message;
            const favs = getFavorites();
            show = favs.some(f => f.key === key);
        } else if (currentFilter !== 'all' && log.type.toLowerCase() !== currentFilter) {
            show = false;
        }

        if (show && currentSource !== 'all') {
            if (currentSource === 'game') show = log.source === 'GAME';
            else if (currentSource === 'mod') show = log.source === 'MOD';
            else show = log.blockName === currentSource;
        }

        if (show && search) {
            show = (log.message || '').toLowerCase().includes(search) ||
                (log.hint || '').toLowerCase().includes(search) ||
                (log.blockName || '').toLowerCase().includes(search);
        }

        if (show) filtered.push(log);
    }

    return filtered;
}

function renderLogs() {
    if (currentTab === 'external') {
        renderExternalLogs();
        return;
    }

    const container = document.getElementById('logs');
    if (!container) return;

    const logs = currentTab === 'server' ? serverLogs : allLogs;
    const filteredLogs = filterLogsArray(logs);

    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    container.innerHTML = '';

    if (filteredLogs.length === 0) {
        if (logs.length === 0) {
            const icon = currentTab === 'server' ? '🖥️' : '📡';
            const msg = currentTab === 'server' ? 'Select server folder to start monitoring...' : 'Waiting for 7 Days to Die to start...';
            container.innerHTML = `<div class="empty-state">
                <div style="font-size:48px;margin-bottom:20px;">${icon}</div>
                <p>${msg}</p>
            </div>`;
        } else {
            container.innerHTML = `<div class="empty-state">
                <div style="font-size:48px;margin-bottom:20px;">🔍</div>
                <p>No logs match the current filters</p>
            </div>`;
        }
    } else {
        for (let i = 0; i < filteredLogs.length; i++) {
            container.appendChild(createLogEntry(filteredLogs[i], i));
        }
    }

    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }

    document.getElementById('totalCount').textContent = filteredLogs.length;
    updateSelectedCount();
}

function renderExternalLogs() {
    const container = document.getElementById('logs');
    if (!container) return;

    document.getElementById('gameVersion').textContent = externalGameVersion;
    document.getElementById('engineVersion').textContent = externalEngineVersion;
    document.getElementById('logFilePath').textContent = externalFilePath;

    if (externalLogs.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div style="font-size:48px;margin-bottom:20px;">📂</div>
            <p>Drag & drop a log file here</p>
            <p style="font-size:12px;color:#666;margin-top:10px;">or <a href="#" id="browseLink">click to browse</a></p>
            <input type="file" id="fileInput" style="display:none;" accept=".txt,.log">
        </div>`;

        setTimeout(() => {
            const browseLink = document.getElementById('browseLink');
            const fileInput = document.getElementById('fileInput');
            if (browseLink && fileInput) {
                browseLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    fileInput.click();
                });
                fileInput.addEventListener('change', function () {
                    if (this.files[0]) loadExternalFile(this.files[0]);
                });
            }
        }, 100);

        return;
    }

    const filteredLogs = filterLogsArray(externalLogs);
    container.innerHTML = '';

    if (filteredLogs.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div style="font-size:48px;margin-bottom:20px;">🔍</div>
            <p>No logs match the current filters</p>
        </div>`;
    } else {
        for (let i = 0; i < filteredLogs.length; i++) {
            const entry = createLogEntry(filteredLogs[i], i);
            container.appendChild(entry);
        }
    }

    document.getElementById('totalCount').textContent = filteredLogs.length;
    updateSelectedCount();
}

function createLogEntry(log, index) {
    const div = document.createElement('div');
    const colorClass = getColorClass(log.type);
    const icon = getIcon(log.type);
    div.className = 'log-entry ' + colorClass;
    div.setAttribute('data-log-index', index);

    let sourceHtml = '';
    if (log.blockName && log.source === 'MOD') {
        const sourceClass = log.blockName.includes('(FAILED)') ? 'FAILED' : 'MOD';
        sourceHtml = `<span class="log-source ${sourceClass}">${escapeHTML(log.blockName)}</span>`;
    } else {
        sourceHtml = `<span class="log-source ${log.source}">${log.source}</span>`;
    }

    let html = '<div class="log-header" style="display:flex;align-items:center;">';
    html += `<input type="checkbox" class="log-checkbox" onchange="updateSelectedCount()" data-index="${index}">`;
    html += `<span class="log-time">[${log.timestamp}]</span>`;
    html += sourceHtml;
    html += `<span>${icon} ${escapeHTML(log.message).replace(/\n/g, '<br>')}</span>`;
    html += '</div>';

    if (log.hint) {
        const hintClass = log.type === 'ERROR' ? 'log-hint' : 'log-hint warn-hint';
        const hintIcon = log.type === 'ERROR' ? '⚠️' : '💡';
        html += `<div class="${hintClass}">${hintIcon} <b>HINT:</b> ${escapeHTML(log.hint)}</div>`;
    }

    div.innerHTML = html;
    return div;
}

// ==================== Helper Functions ====================
function selectServerPath(path) {
    serverLogPath = path;
    if (currentTab === 'server') {
        document.getElementById('logFilePath').textContent = 'Server: ' + path;
        document.getElementById('statusIndicator').textContent = '● LIVE';
        document.getElementById('statusIndicator').className = 'status watching';
    }
}

function getColorClass(type) {
    switch (type.toUpperCase()) {
        case 'ERROR': return 'error';
        case 'WARN': return 'warn';
        case 'DEBUG': return 'debug';
        default: return 'info';
    }
}

function getIcon(type) {
    switch (type.toUpperCase()) {
        case 'ERROR': return '❌';
        case 'WARN': return '⚠️';
        case 'DEBUG': return '🔍';
        default: return '💬';
    }
}

function detectLogType(line) {
    if (!line) return 'INFO';
    const upper = line.toUpperCase();
    const parts = line.split(/\s+/);

    if (parts.length >= 3) {
        const logLevel = parts[2]?.toUpperCase();
        if (['EXC', 'ERR', 'ASS'].includes(logLevel)) return 'ERROR';
        if (logLevel === 'WRN') return 'WARN';
        if (logLevel === 'INF') return 'INFO';
        if (logLevel === 'DBG') return 'DEBUG';
    }

    if (upper.includes(' EXC ') || upper.includes(' ERR ') || upper.includes(' ASS ')) return 'ERROR';
    if (upper.includes(' WRN ')) return 'WARN';
    if (upper.includes(' INF ')) return 'INFO';
    if (upper.includes(' DBG ')) return 'DEBUG';
    if (upper.includes('EXCEPTION') || upper.includes('FATAL')) return 'ERROR';
    if (upper.includes('WARNING') || upper.includes('WARN')) return 'WARN';
    if (upper.includes('DEBUG')) return 'DEBUG';

    return 'INFO';
}

function detectLogSource(line) {
    if (!line) return { source: 'GAME', modName: null };

    const loadedMatch = line.match(/Loaded Mod: (.+?) \(/);
    if (loadedMatch) {
        const modName = loadedMatch[1];
        if (!knownMods.includes(modName)) knownMods.push(modName);
        return { source: 'MOD', modName };
    }

    const initMatch = line.match(/Initialized code in mod '(.+?)'/);
    if (initMatch) {
        const modName = initMatch[1];
        if (!knownMods.includes(modName)) knownMods.push(modName);
        return { source: 'MOD', modName };
    }

    const failMatch = line.match(/Failed initializing ModAPI instance on mod '(.+?)'/);
    if (failMatch) return { source: 'MOD', modName: failMatch[1] + ' (FAILED)' };

    if (line.includes('[MODS]')) return { source: 'MOD', modName: null };

    const tagMatch = line.match(/\[(\w+)\]/);
    if (tagMatch) {
        const tag = tagMatch[1];
        if (['CBL', 'Harmony', 'DMT'].includes(tag) || knownMods.includes(tag)) {
            return { source: 'MOD', modName: tag };
        }
    }

    return { source: 'GAME', modName: null };
}

function generateHint(message, type) {
    if (!message) return '';
    if (type === 'INFO' || type === 'DEBUG') return '';

    const lower = message.toLowerCase();

    for (const hint of customHints) {
        const keys = hint.key.split(',');
        const allMatch = keys.every(key => lower.includes(key.trim().toLowerCase()));
        if (allMatch) return hint.value;
    }

    const builtInHints = {
        'nullreferenceexception': 'NullReferenceException: An object was not initialized before use.',
        'argumentnullexception': 'ArgumentNullException: A required parameter is null.',
        'indexoutofrangeexception': 'IndexOutOfRangeException: Check collection sizes in XML.',
        'filenotfoundexception': 'FileNotFoundException: Required file is missing.',
        'xmlexception': 'XMLException: XML parsing error. Check syntax.',
        'failed parsing xml': 'XML syntax error. Check for mismatched tags.',
        'does not match the end tag': 'XML tag mismatch. Check opening/closing tags.',
        'failed loading mod': 'Mod failed to load. Check ModInfo.xml.',
        'failed initializing modapi': 'ModAPI initialization failed.',
        'object reference not set': 'NullReferenceException in mod code.',
        'field not found': 'Version mismatch error. Update mods or save.',
        'recalculatecell': 'Terrain recalculation. Normal behavior.',
        'block not found': 'Block ID not found. Check blocks.xml.',
        'item not found': 'Item ID not found. Check items.xml.',
        'entity not found': 'Entity ID not found. Check entityclasses.xml.',
        'quest not found': 'Quest ID not found. Check quests.xml.',
        'buff not found': 'Buff ID not found. Check buffs.xml.',
        'exception': 'An exception was thrown. Check stack trace.'
    };

    for (const [key, value] of Object.entries(builtInHints)) {
        if (lower.includes(key)) return value;
    }

    const quotedMatch = message.match(/'(.*?)'/);
    if (quotedMatch) {
        const quotedText = quotedMatch[1];

        if (lower.includes('lootcontainer') && lower.includes('unknown')) {
            return `Loot container '${quotedText}' was not found. A mod may have removed this container, or a prefab is referencing an outdated container name.`;
        }
        if (lower.includes('block') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Block '${quotedText}' was not found. Check blocks.xml for correct block names. A mod may have removed or renamed this block.`;
        }
        if (lower.includes('item') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Item '${quotedText}' was not found. Check items.xml for correct item names. A mod may have removed or renamed this item.`;
        }
        if (lower.includes('entity') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Entity '${quotedText}' was not found. Check entityclasses.xml for correct entity names.`;
        }
        if (lower.includes('buff') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Buff '${quotedText}' was not found. Check buffs.xml for correct buff names.`;
        }
        if (lower.includes('recipe') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Recipe '${quotedText}' was not found. Check recipes.xml for correct recipe names.`;
        }
        if (lower.includes('quest') && (lower.includes('not found') || lower.includes('unknown'))) {
            return `Quest '${quotedText}' was not found. Check quests.xml for correct quest names.`;
        }

        // Generic not found
        if (lower.includes('not found') || lower.includes('unknown')) {
            return `'${quotedText}' was not found. This usually means a mod is referencing something that doesn't exist or was removed.`;
        }
    }

    const xmlMatch = message.match(/['"](\w+\.xml)['"]/i);
    if (xmlMatch) {
        const xmlFile = xmlMatch[1];
        let hint = `XML error in ${xmlFile}. `;

        // Extract mod name if present
        const modMatch = message.match(/from mod "([^"]+)"/i);
        const modName = modMatch ? modMatch[1] : null;

        // XML patch did not apply
        if (lower.includes('did not apply') || lower.includes('patch')) {
            if (modName) {
                hint += `An XML patch from mod "${modName}" failed to apply to ${xmlFile}. `;
            } else {
                hint += `An XML patch failed to apply to ${xmlFile}. `;
            }
            hint += `The mod may be incompatible with the current game version or conflict with another mod.`;
        }
        // XML failed to load/parse
        else if (lower.includes('loading and parsing') || lower.includes('failed')) {
            if (modName) {
                hint += `Mod "${modName}" failed to load ${xmlFile}. `;
            }
            hint += `Check for syntax errors, duplicate entries, or references to items/blocks that don't exist.`;
        }
        // Duplicate key
        else if (lower.includes('duplicate') || lower.includes('already been added') || lower.includes('already exists')) {
            hint += `Duplicate entry found. Two mods may be adding the same item, block, or recipe.`;
        }
        // Block/item not found in XML
        else if (lower.includes('not found') || lower.includes("doesn't exist") || lower.includes('no item/block')) {
            hint += `A referenced item or block was not found. A mod may have a missing dependency or the item/block was removed.`;
        }
        // General XML error with mod name
        else if (modName) {
            hint += `Error related to mod "${modName}". Check the mod's XML files for errors or incompatibilities.`;
        }
        // General XML error
        else {
            hint += `Check the file for syntax errors, missing tags, or invalid references.`;
        }

        return hint;
    }

    // Auto-detect Harmony AccessTools errors
    if (lower.includes('accesstools.declaredmethod') || lower.includes('could not find method for type')) {
        const typeMatch = message.match(/for type (\S+)/i);
        const methodMatch = message.match(/and name (\S+)/i);
        const type = typeMatch ? typeMatch[1] : 'unknown';
        const method = methodMatch ? methodMatch[1] : 'unknown';
        return `Harmony could not find method "${method}" in type "${type}". The mod that patches this is likely incompatible with the current game version and needs to be updated.`;
    }

    // Auto-detect duplicate block/item warnings
    if ((lower.includes('block') || lower.includes('item')) && lower.includes('is found multiple times')) {
        const nameMatch = message.match(/(?:Block|Item)\s+(\S+)\s+is found multiple times/i);
        const name = nameMatch ? nameMatch[1] : 'unknown';
        return `'${name}' is defined by multiple mods. The last loaded definition will be used. This may cause unexpected behavior if the mods are incompatible.`;
    }

    return '';
}

function extractKnownMods(logs) {
    for (const log of logs) {
        if (log.blockName && !log.blockName.includes('(FAILED)') && !knownMods.includes(log.blockName)) {
            knownMods.push(log.blockName);
            addModToDropdown(log.blockName);
        }
    }
    console.log('KNOWN MODS UPDATED:', knownMods);
    window.electronAPI.updateKnownMods(knownMods);
}

function addModToDropdown(mod) {
    if (mod === 'CLS') return;

    const menu = document.getElementById('dropdownMenu');
    if (!menu) return;

    const exists = Array.from(menu.querySelectorAll('a')).some(a => a.textContent === mod);
    if (exists) return;

    const a = document.createElement('a');
    a.href = '#';
    a.textContent = mod;
    a.onclick = (e) => {
        e.preventDefault();
        filterBySource(mod);
    };
    menu.appendChild(a);
}

function updateSourceDropdown() {
    const menu = document.getElementById('dropdownMenu');
    if (!menu) return;

    const items = menu.querySelectorAll('a');
    items.forEach(a => {
        const onclick = a.getAttribute('onclick') || '';
        if (onclick.includes('filterBySource') &&
            !onclick.includes('all') &&
            !onclick.includes('game') &&
            !onclick.includes('mod')) {
            a.remove();
        }
    });

    knownMods.forEach(mod => {
        if (mod !== 'CLS') {
            const exists = menu.querySelector(`a[onclick*="filterBySource('${mod}')"]`);
            if (!exists) {
                const a = document.createElement('a');
                a.href = '#';
                a.textContent = mod;
                a.onclick = (e) => {
                    e.preventDefault();
                    filterBySource(mod);
                };
                menu.appendChild(a);
            }
        }
    });
}

// ==================== Statistics ====================
function extractModsFromLiveLogs() {
    const mods = [];
    for (const log of allLogs) {
        if (log.blockName && !log.blockName.includes('(FAILED)') && !mods.includes(log.blockName)) {
            mods.push(log.blockName);
        }
    }
    rebuildModDropdown(mods);
}

function extractModsFromServerLogs() {
    const mods = [];
    for (const log of serverLogs) {
        if (log.blockName && !log.blockName.includes('(FAILED)') && !mods.includes(log.blockName)) {
            mods.push(log.blockName);
        }
    }
    mods.forEach(mod => addModToDropdown(mod));
}

function extractModsFromExternalLogs() {
    const mods = [];
    for (const log of externalLogs) {
        if (log.blockName && !log.blockName.includes('(FAILED)') && !mods.includes(log.blockName)) {
            mods.push(log.blockName);
        }
    }
    console.log('External mods found:', mods.length, mods);
    rebuildModDropdown(mods);
}

function rebuildModDropdown(mods) {
    const menu = document.getElementById('dropdownMenu');
    if (!menu) return;

    // Remove ALL mod entries (keep All/Game/Mod)
    const allLinks = menu.querySelectorAll('a');
    allLinks.forEach(a => {
        const text = a.textContent;
        if (text !== 'All Sources' && text !== '🎮 Game Only' && text !== '🧩 All Mods') {
            a.remove();
        }
    });

    // Add new mods
    mods.forEach(mod => addModToDropdown(mod));
}

function updateStats() {
    let logs;
    if (currentTab === 'live') logs = allLogs;
    else if (currentTab === 'server') logs = serverLogs;
    else logs = externalLogs;

    let errorCount = 0, warnCount = 0, infoCount = 0, debugCount = 0;

    for (const log of logs) {
        switch (log.type.toUpperCase()) {
            case 'ERROR': errorCount++; break;
            case 'WARN': warnCount++; break;
            case 'DEBUG': debugCount++; break;
            default: infoCount++;
        }
    }

    document.getElementById('statErrors').textContent = errorCount;
    document.getElementById('statWarns').textContent = warnCount;
    document.getElementById('statInfo').textContent = infoCount;
    document.getElementById('statDebug').textContent = debugCount;
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// ==================== Filters ====================
function filterBy(type) {
    const container = document.getElementById('logs');
    if (container) {
        const oldKey = `cls_scroll_${currentTab}_${currentFilter}_${currentSource}`;
        sessionStorage.setItem(oldKey, container.scrollTop);
    }

    previousFilter = currentFilter;
    currentFilter = type;
    sessionStorage.setItem('cls_filter', type);
    lastLogCount = 0;
    updateButtons();
    if (currentTab === 'live' || currentTab === 'server') renderLogs();
    else renderExternalLogs();
    updateSelectedCount();
}

function toggleFavorites() {
    const container = document.getElementById('logs');
    if (container) {
        const oldKey = `cls_scroll_${currentTab}_${currentFilter}_${currentSource}`;
        sessionStorage.setItem(oldKey, container.scrollTop);
    }

    if (currentFilter === 'favorites') {
        currentFilter = previousFilter;
    } else {
        previousFilter = currentFilter;
        currentFilter = 'favorites';
    }
    sessionStorage.setItem('cls_filter', currentFilter);
    lastLogCount = 0;
    updateButtons();
    if (currentTab === 'live' || currentTab === 'server') renderLogs();
    else renderExternalLogs();
    updateSelectedCount();
}

function filterBySource(source) {
    const container = document.getElementById('logs');
    if (container) {
        const oldKey = `cls_scroll_${currentTab}_${currentFilter}_${currentSource}`;
        sessionStorage.setItem(oldKey, container.scrollTop);
    }

    currentSource = source;
    sessionStorage.setItem('cls_source', source);
    lastLogCount = 0;
    updateButtons();
    if (currentTab === 'live' || currentTab === 'server') renderLogs();
    else renderExternalLogs();
    updateSelectedCount();
}

function onSearchChange() {
    const container = document.getElementById('logs');
    if (container) {
        const oldKey = `cls_scroll_${currentTab}_${currentFilter}_${currentSource}`;
        sessionStorage.setItem(oldKey, container.scrollTop);
    }

    savedSearch = document.getElementById('search').value;
    sessionStorage.setItem('cls_search', savedSearch);
    lastLogCount = 0;
    if (currentTab === 'live' || currentTab === 'server') renderLogs();
    else renderExternalLogs();
    updateSelectedCount();
}

function updateButtons() {
    document.querySelectorAll('.btn:not(.source):not(#btnFav):not(.small):not(#btnWatch)').forEach(b => b.classList.remove('active'));

    if (currentFilter !== 'favorites') {
        const typeBtn = document.getElementById('btn' + currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1));
        if (typeBtn) typeBtn.classList.add('active');
    }

    const favBtn = document.getElementById('btnFav');
    if (favBtn) {
        if (currentFilter === 'favorites') favBtn.classList.add('active');
        else favBtn.classList.remove('active');
    }

    document.querySelectorAll('.btn.source').forEach(b => b.classList.remove('active'));
    const sourceBtn = document.getElementById('btnSourceMain');
    if (sourceBtn) {
        sourceBtn.classList.add('active');
        if (currentSource === 'all') sourceBtn.classList.add('all');
        else if (currentSource === 'game') sourceBtn.classList.add('game');
        else if (currentSource === 'mod') sourceBtn.classList.add('mod');
    }

    const labelMap = { 'all': 'All Sources', 'game': '🎮 Game Only', 'mod': '🧩 All Mods' };
    const label = document.getElementById('sourceLabel');
    if (label) {
        if (labelMap[currentSource]) label.textContent = labelMap[currentSource];
        else label.textContent = currentSource;
    }

    document.querySelectorAll('#dropdownMenu a').forEach(a => a.classList.remove('active'));
    const activeLink = document.querySelector(`#dropdownMenu a[onclick*="filterBySource('${currentSource}')"]`);
    if (activeLink) activeLink.classList.add('active');
}

// ==================== Tabs ====================
function switchTab(tab) {
    currentTab = tab;
    sessionStorage.setItem('cls_tab', tab);
    lastLogCount = 0;

    document.getElementById('tabLive').classList.toggle('active', tab === 'live');
    document.getElementById('tabServer').classList.toggle('active', tab === 'server');
    document.getElementById('tabExternal').classList.toggle('active', tab === 'external');

    const clearBtnExternal = document.getElementById('btnClearExternal');
    if (clearBtnExternal) clearBtnExternal.style.display = tab === 'external' ? '' : 'none';

    // Show/hide path info
    document.getElementById('livePathInfo').style.display = tab === 'live' ? '' : 'none';
    document.getElementById('serverPathInfo').style.display = tab === 'server' ? '' : 'none';

    // Clear mod dropdown
    const menu = document.getElementById('dropdownMenu');
    if (menu) {
        const allLinks = menu.querySelectorAll('a');
        allLinks.forEach(a => {
            const text = a.textContent;
            if (text !== 'All Sources' && text !== '🎮 Game Only' && text !== '🧩 All Mods') {
                a.remove();
            }
        });
    }

    if (tab === 'external') {
        document.getElementById('gameVersion').textContent = externalGameVersion;
        document.getElementById('engineVersion').textContent = externalEngineVersion;
        document.getElementById('logFilePath').textContent = externalFilePath;
        extractModsFromExternalLogs();
        renderExternalLogs();
    } else if (tab === 'server') {
        document.getElementById('gameVersion').textContent = serverGameVersion;
        document.getElementById('engineVersion').textContent = serverEngineVersion;
        document.getElementById('logFilePath').textContent = serverLogPath;
        extractModsFromServerLogs();
        renderLogs();
    } else {
        document.getElementById('gameVersion').textContent = liveGameVersion;
        document.getElementById('engineVersion').textContent = liveEngineVersion;
        document.getElementById('logFilePath').textContent = liveLogPath;
        rebuildModDropdown(knownMods);
        renderLogs();
    }

    updateStats();
    updateFavCount();
    updateSelectedCount();

    const logs = getActiveLogs();
    const filtered = filterLogsArray(logs);
    document.getElementById('totalCount').textContent = filtered.length;
}


function restoreTab() {
    currentTab = sessionStorage.getItem('cls_tab') || 'live';
    if (currentTab === 'external') {
        document.getElementById('tabLive').classList.remove('active');
        document.getElementById('tabExternal').classList.add('active');
        const clearBtn = document.getElementById('btnClearExternal');
        if (clearBtn) clearBtn.style.display = '';
        document.getElementById('gameVersion').textContent = externalGameVersion;
        document.getElementById('engineVersion').textContent = externalEngineVersion;
        document.getElementById('logFilePath').textContent = externalFilePath;
        renderExternalLogs();
    } else if (currentTab === 'server') {
        document.getElementById('tabLive').classList.remove('active');
        document.getElementById('tabServer').classList.add('active');
        document.getElementById('livePathInfo').style.display = 'none';
        document.getElementById('serverPathInfo').style.display = '';
        document.getElementById('gameVersion').textContent = serverGameVersion;
        document.getElementById('engineVersion').textContent = serverEngineVersion;
        document.getElementById('logFilePath').textContent = serverLogPath;
        renderLogs();
    }
}

function clearExternalLogs() {
    externalLogs = [];
    externalGameVersion = 'N/A';
    externalEngineVersion = 'N/A';
    externalFilePath = 'No file loaded';
    favoritesExternal = [];
    lastLogCount = 0;
    rebuildModDropdown([]);
    renderExternalLogs();
    updateStats();
    updateFavCount();
    updateSelectedCount();
}

// ==================== Selection and Favorites ====================
function selectAllLogs() {
    const checkboxes = document.querySelectorAll('.log-checkbox');
    checkboxes.forEach(cb => {
        if (cb.closest('.log-entry') && cb.closest('.log-entry').offsetParent !== null) {
            cb.checked = true;
        }
    });
    updateSelectedCount();
}

function deselectAllLogs() {
    document.querySelectorAll('.log-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = document.querySelectorAll('.log-checkbox:checked').length;
    document.getElementById('selectedCount').textContent = count;
}

function getSelectedLogs() {
    const selected = [];
    const checkboxes = document.querySelectorAll('.log-checkbox:checked');
    const logs = getActiveLogs();
    const filteredLogs = filterLogsArray(logs);

    checkboxes.forEach(cb => {
        const index = parseInt(cb.getAttribute('data-index'));
        if (index >= 0 && index < filteredLogs.length) {
            selected.push(filteredLogs[index]);
        }
    });

    return selected;
}

function deleteSelectedLogs() {
    const selected = getSelectedLogs();
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} selected log(s)?\nThis cannot be undone.`)) return;

    if (currentTab === 'live') {
        for (const log of selected) {
            const key = log.timestamp + '|' + log.message;
            if (!deletedKeys.includes(key)) deletedKeys.push(key);
            favoritesLive = favoritesLive.filter(f => f.key !== key);
        }
        sessionStorage.setItem('cls_deleted', JSON.stringify(deletedKeys));
        allLogs = allLogs.filter(log => {
            const key = log.timestamp + '|' + log.message;
            return !deletedKeys.includes(key);
        });
    } else if (currentTab === 'server') {
        for (const log of selected) {
            serverLogs = serverLogs.filter(l => l !== log);
            const key = log.timestamp + '|' + log.message;
            favoritesServer = favoritesServer.filter(f => f.key !== key);
        }
    } else {
        for (const log of selected) {
            externalLogs = externalLogs.filter(l => l !== log);
            const key = log.timestamp + '|' + log.message;
            favoritesExternal = favoritesExternal.filter(f => f.key !== key);
        }
    }

    saveFavorites();
    updateFavCount();
    lastLogCount = 0;
    if (currentTab === 'live' || currentTab === 'server') renderLogs();
    else renderExternalLogs();
    updateSelectedCount();
}

function getFavorites() {
    if (currentTab === 'live') return favoritesLive;
    if (currentTab === 'server') return favoritesServer;
    return favoritesExternal;
}

function saveFavorites() {
    if (currentTab === 'live') {
        sessionStorage.setItem('cls_favorites_live', JSON.stringify(favoritesLive));
    } else if (currentTab === 'server') {
        sessionStorage.setItem('cls_favorites_server', JSON.stringify(favoritesServer));
    } else {
        sessionStorage.setItem('cls_favorites_external', JSON.stringify(favoritesExternal));
    }
}

function addToFavorites() {
    const selected = getSelectedLogs();
    const favs = getFavorites();
    for (const log of selected) {
        const key = log.timestamp + '|' + log.message;
        if (!favs.find(f => f.key === key)) {
            favs.push({ key, log });
        }
    }
    if (currentTab === 'live') favoritesLive = favs;
    else if (currentTab === 'server') favoritesServer = favs;
    else favoritesExternal = favs;
    saveFavorites();
    updateFavCount();
    if (currentFilter === 'favorites') {
        if (currentTab === 'live' || currentTab === 'server') renderLogs();
        else renderExternalLogs();
    }
}

function removeFromFavorites() {
    const selected = getSelectedLogs();
    let favs = getFavorites();
    for (const log of selected) {
        const key = log.timestamp + '|' + log.message;
        favs = favs.filter(f => f.key !== key);
    }
    if (currentTab === 'live') favoritesLive = favs;
    else if (currentTab === 'server') favoritesServer = favs;
    else favoritesExternal = favs;
    saveFavorites();
    updateFavCount();
    if (currentFilter === 'favorites') {
        if (currentTab === 'live' || currentTab === 'server') renderLogs();
        else renderExternalLogs();
    }
}

function updateFavCount() {
    let favs;
    if (currentTab === 'live') favs = favoritesLive;
    else if (currentTab === 'server') favs = favoritesServer;
    else favs = favoritesExternal;
    document.getElementById('favCount').textContent = favs.length;
}

// ==================== Dropdowns ====================
let dropdownOpen = false;

function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
    document.getElementById('dropdownMenu').style.display = dropdownOpen ? 'block' : 'none';
}

function toggleExportDropdown() {
    const menu = document.getElementById('exportMenu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function initDropdowns() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            dropdownOpen = false;
            document.getElementById('dropdownMenu').style.display = 'none';
            document.getElementById('exportMenu').style.display = 'none';
        }
    });
}

// ==================== Export ====================
async function exportLogsSimple(type) {
    let logs = [];

    if (type === 'all') {
        logs = getActiveLogs();
    } else if (type === 'selected') {
        logs = getSelectedLogs();
    } else if (type === 'filter') {
        logs = filterLogsArray(getActiveLogs());
    } else if (type === 'favorites') {
        logs = [];
        const favs = getFavorites();
        const source = getActiveLogs();
        for (const f of favs) {
            const found = source.find(l => (l.timestamp + '|' + l.message) === f.key);
            if (found) logs.push(found);
        }
    }

    if (logs.length === 0) {
        alert('No logs to export!');
        return;
    }

    let content = '';
    for (const log of logs) {
        content += '[' + log.timestamp + '] ' + log.message + '\n';
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const saved = await window.electronAPI.saveFile(content, `cls_logs_${type}_${timestamp}.txt`);
    if (saved) {
        document.getElementById('exportMenu').style.display = 'none';
    }
}

// ==================== Utilities ====================
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

function escapeHTML(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeXML(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}