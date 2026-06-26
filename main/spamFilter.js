class SpamFilter {
    constructor() {
        this.lastSpamKey = '';
        this.duplicateCount = 0;
        this.rules = [];
    }

    loadRules(rules) {
        this.rules = rules;
    }

    getSpamKey(message) {
        if (!message) return message;

        for (const rule of this.rules) {
            if (!message.includes(rule.value)) continue;

            switch (rule.mode) {
                case 'ReplaceNumbers':
                    return rule.value + '::' + message.replace(/\d+/g, '*');
                case 'FirstChars':
                    const len = Math.min(rule.length || 50, message.length);
                    return rule.value + '::' + message.substring(0, len);
                case 'TrimAfter':
                    const idx = message.indexOf(rule.separator || ':');
                    if (idx >= 0) return rule.value + '::' + message.substring(0, idx).trimEnd();
                    break;
                default:
                    return message;
            }
        }
        return message;
    }

    isDuplicate(spamKey, type, lastMessageRef) {
        if (spamKey === this.lastSpamKey && type !== 'ERROR') {
            this.duplicateCount++;
            if (this.duplicateCount > 1) {
                const repeatIdx = lastMessageRef.value ? lastMessageRef.value.lastIndexOf(' (x') : -1;
                if (repeatIdx > 0) {
                    return {
                        isDuplicate: true,
                        updatedMessage: lastMessageRef.value.substring(0, repeatIdx) + ` (x${this.duplicateCount})`
                    };
                } else {
                    return {
                        isDuplicate: true,
                        updatedMessage: lastMessageRef.value + ` (x${this.duplicateCount})`
                    };
                }
            }
            return { isDuplicate: true, updatedMessage: null };
        }

        this.lastSpamKey = spamKey;
        this.duplicateCount = 0;
        return { isDuplicate: false, updatedMessage: null };
    }
}

module.exports = { SpamFilter };