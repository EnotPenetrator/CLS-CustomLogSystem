class LogParser {
    static engineVersion = 'Unknown';
    static gameVersion = 'Unknown';

    static cleanMessage(line) {
        // Remove game timestamp prefix: "2026-06-25T13:57:28 0.067 INF "
        return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\s+\d+\.\d+\s+(INF|WRN|ERR|EXC|DBG)\s+/, '');
    }

    static hints = {
        'nullreferenceexception': 'NullReferenceException: An object was not initialized before use. Check that all variables, components, and config values exist before accessing them',
        'argumentnullexception': 'ArgumentNullException: A required parameter is null. Check method arguments and configuration values',
        'indexoutofrangeexception': 'IndexOutOfRangeException: Array/List index out of bounds. Check collection sizes in XML configs and loops',
        'keynotfoundexception': 'KeyNotFoundException: Dictionary key not found. Check that all IDs and references exist in their respective XML files',
        'filenotfoundexception': 'FileNotFoundException: Required file is missing. Check resource paths, asset bundles, and config files',
        'xmlexception': 'XMLException: XML parsing error. Check syntax - mismatched tags, unescaped characters, or invalid structure',
        'invalidoperationexception': 'InvalidOperationException: Operation is not valid for the current state. Check execution order and object states',
        'outofmemoryexception': 'OutOfMemoryException: Not enough memory. Check for memory leaks, reduce texture quality, or close other applications',
        'stackoverflowexception': 'StackOverflowException: Infinite recursion detected. Check for recursive method calls without exit conditions',
        'dividebyzeroexception': 'DivideByZeroException: Division by zero in calculations. Check formulas and math operations',
        'formatexception': 'FormatException: String format is invalid. Check number/date parsing and string.Format() calls',
        'invalidcastexception': 'InvalidCastException: Cannot cast object to type. Check type conversions and inheritance',
        'notsupportedexception': 'NotSupportedException: Operation not supported. Check platform compatibility and feature availability',
        'notimplementedexception': 'NotImplementedException: Method or feature is not implemented yet',
        'unauthorizedaccessexception': 'UnauthorizedAccessException: No permission to access file/folder. Check file permissions and antivirus',
        'ioexception': 'IOException: Input/Output error. Check disk space, file locks, and path validity',
        'timeoutexception': 'TimeoutException: Operation timed out. Check network connection, server status, or increase timeout',
        'failed parsing xml': 'XML syntax error in config file. Check for mismatched tags, missing quotes around attributes, or invalid characters like & or <',
        'does not match the end tag': 'XML tag mismatch. Every opening tag like <Name> must have a matching closing tag </Name> with the exact same name',
        'root element is missing': 'XML file has no root element. Every XML file must have one root tag enclosing all other tags',
        'field not found': 'Version mismatch error. A field expected by the code does not exist. This mod or save may need to be updated for the current game version',
        'failed initializing modapi': 'ModAPI initialization failed. Check that the mod DLL contains a class that implements IModApi with a public InitMod method',
        'object reference not set to an instance': 'NullReferenceException in mod code. Check that all required objects, configs, and Harmony patches are properly initialized',
        'exception': 'An exception was thrown. Check the exception type and stack trace for the root cause'
    };

    static spamFilter = null;
    static excludeFilters = [];
    static lastSpamMessage = { value: '' };

    static checkVersions(line) {
        if (this.engineVersion === 'Unknown') {
            if (line.includes('Initialize engine version:')) {
                const idx = line.indexOf('Initialize engine version:');
                if (idx >= 0) {
                    this.engineVersion = line.substring(idx + 'Initialize engine version:'.length).trim();
                }
            }
        }
        if (this.gameVersion === 'Unknown') {
            if (line.includes('Version:') && line.includes('Compatibility')) {
                const verMatch = line.match(/Version: (.+?),/);
                if (verMatch) {
                    this.gameVersion = verMatch[1].trim();
                }
            }
        }
    }

    static parse(line, customHints = []) {
        if (!line || !line.trim()) return null;

        // Skip lines that don't start with game timestamp (they are continuations)
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line)) return null;

        // Check versions
        this.checkVersions(line);

        if (this.excludeFilters.some(filter => line.includes(filter))) {
            return null;
        }

        if (this.spamFilter) {
            const spamKey = this.spamFilter.getSpamKey(line);
            const result = this.spamFilter.isDuplicate(spamKey, this.detectType(line), this.lastSpamMessage);

            if (result.isDuplicate) {
                if (result.updatedMessage) {
                    this.lastSpamMessage.value = result.updatedMessage;
                    const type = this.detectType(line);
                    const { source, modName } = this.detectSource(line);
                    return {
                        timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Math.floor(Math.random() * 1000)).padStart(3, '0'),
                        type,
                        message: result.updatedMessage,
                        source,
                        blockName: modName || null,
                        hint: this.generateHint(line, type, customHints)
                    };
                }
                return null;
            }
        }

        this.lastSpamMessage.value = line;

        const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
        const type = this.detectType(line);
        const { source, modName } = this.detectSource(line);

        return {
            timestamp,
            type,
            message: this.cleanMessage(line),
            source,
            blockName: modName || null,
            hint: this.generateHint(line, type, customHints)
        };
    }

    static detectType(line) {
        if (!line) return 'INFO';
        const upper = line.toUpperCase();

        // Check all lines for highest severity
        const lines = line.split('\n');
        let maxLevel = 0; // 0=INFO, 1=DEBUG, 2=WARN, 3=ERROR

        for (const l of lines) {
            const upperL = l.toUpperCase();

            // Check standard log level (third word)
            const parts = l.split(/\s+/);
            if (parts.length >= 3) {
                const level = parts[2]?.toUpperCase();
                if (['EXC', 'ERR', 'ASS'].includes(level)) maxLevel = Math.max(maxLevel, 3);
                else if (level === 'WRN') maxLevel = Math.max(maxLevel, 2);
                else if (level === 'INF') maxLevel = Math.max(maxLevel, 0);
                else if (level === 'DBG') maxLevel = Math.max(maxLevel, 1);
            }

            // Check for ERROR/WARNING anywhere in line
            if (upperL.includes('ERROR') || upperL.includes('EXCEPTION') || upperL.includes('FATAL')) {
                maxLevel = Math.max(maxLevel, 3);
            }
            if (upperL.includes('WARNING') || upperL.includes('WARN')) {
                maxLevel = Math.max(maxLevel, 2);
            }
            if (upperL.includes('DEBUG') || upperL.includes('DBG')) {
                maxLevel = Math.max(maxLevel, 1);
            }
        }

        if (maxLevel >= 3) return 'ERROR';
        if (maxLevel >= 2) return 'WARN';
        if (maxLevel >= 1) return 'DEBUG';
        return 'INFO';
    }

    static detectSource(line) {
        if (!line) return { source: 'GAME', modName: null };

        const loadedMatch = line.match(/Loaded Mod: (.+?) \(/);
        if (loadedMatch) {
            return { source: 'MOD', modName: loadedMatch[1] };
        }

        const initMatch = line.match(/Initialized code in mod '(.+?)'/);
        if (initMatch) {
            return { source: 'MOD', modName: initMatch[1] };
        }

        const failMatch = line.match(/Failed initializing ModAPI instance on mod '(.+?)'/);
        if (failMatch) {
            return { source: 'MOD', modName: failMatch[1] + ' (FAILED)' };
        }

        if (line.includes('[MODS]')) return { source: 'MOD', modName: null };

        const tagMatch = line.match(/\[(\w+)\]/);
        if (tagMatch) {
            const tag = tagMatch[1];
            console.log('DETECT SOURCE TAG:', tag, 'knownMods:', this.knownMods, 'customModTags:', this.customModTags);
            if (['CBL', 'Harmony', 'DMT'].includes(tag) ||
                (this.knownMods && this.knownMods.includes(tag)) ||
                (this.customModTags && this.customModTags.includes(tag))) {
                return { source: 'MOD', modName: tag };
            }
        }

        return { source: 'GAME', modName: null };
    }

    static generateHint(message, type, customHints = []) {
        if (!message) return '';
        if (type === 'INFO' || type === 'DEBUG') return '';

        const lower = message.toLowerCase();
        for (const hint of customHints) {
            const keys = hint.key.split(',');
            const allMatch = keys.every(key => lower.includes(key.trim().toLowerCase()));
            if (allMatch) return hint.value;
        }

        for (const [key, value] of Object.entries(this.hints)) {
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
        // Auto-detect duplicate block/item warnings
        if ((lower.includes('block') || lower.includes('item')) && lower.includes('is found multiple times')) {
            const nameMatch = message.match(/(?:Block|Item)\s+(\S+)\s+is found multiple times/i);
            const name = nameMatch ? nameMatch[1] : 'unknown';
            return `'${name}' is defined by multiple mods. The last loaded definition will be used. This may cause unexpected behavior if the mods are incompatible.`;
        }

        // Auto-detect Harmony AccessTools errors
        if (lower.includes('accesstools.declaredmethod') || lower.includes('could not find method for type')) {
            const typeMatch = message.match(/for type (\S+)/i);
            const methodMatch = message.match(/and name (\S+)/i);
            const type = typeMatch ? typeMatch[1] : 'unknown';
            const method = methodMatch ? methodMatch[1] : 'unknown';
            return `Harmony could not find method "${method}" in type "${type}". The mod that patches this is likely incompatible with the current game version and needs to be updated.`;
        }
        return '';
    }
}

module.exports = { LogParser };