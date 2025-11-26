/**
 * Bash Command Analysis Module
 *
 * Determines whether bash commands are read-only (safe) or write-like (requires approval).
 * Ported from cc-sessions to provide DAIC enforcement for OpenSpec.
 */

// ============================================================================
// Read-Only Command Whitelist
// ============================================================================

const READONLY_FIRST = new Set([
    // Basic file reading
    'cat', 'less', 'more', 'head', 'tail', 'wc', 'nl', 'tac', 'rev',
    // Text search and filtering
    'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack',
    // Text processing (all safe for reading)
    'sort', 'uniq', 'cut', 'paste', 'join', 'comm', 'column',
    'tr', 'expand', 'unexpand', 'fold', 'fmt', 'pr', 'shuf', 'tsort',
    // Comparison
    'diff', 'cmp', 'sdiff', 'vimdiff',
    // Checksums
    'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'cksum', 'sum',
    // Binary inspection
    'od', 'hexdump', 'xxd', 'strings', 'file', 'readelf', 'objdump', 'nm',
    // File system inspection
    'ls', 'dir', 'vdir', 'pwd', 'which', 'type', 'whereis', 'locate', 'find',
    'basename', 'dirname', 'readlink', 'realpath', 'stat',
    // User/system info
    'whoami', 'id', 'groups', 'users', 'who', 'w', 'last', 'lastlog',
    'hostname', 'uname', 'arch', 'lsb_release', 'hostnamectl',
    'date', 'cal', 'uptime', 'df', 'du', 'free', 'vmstat', 'iostat',
    // Process monitoring
    'ps', 'pgrep', 'pidof', 'top', 'htop', 'iotop', 'atop',
    'lsof', 'jobs', 'pstree', 'fuser',
    // Network monitoring
    'netstat', 'ss', 'ip', 'ifconfig', 'route', 'arp',
    'ping', 'traceroute', 'tracepath', 'mtr', 'nslookup', 'dig', 'host', 'whois',
    // Environment
    'printenv', 'env', 'set', 'export', 'alias', 'history', 'fc',
    // Output
    'echo', 'printf', 'yes', 'seq', 'jot',
    // Testing
    'test', '[', '[[', 'true', 'false',
    // Calculation
    'bc', 'dc', 'expr', 'factor', 'units',
    // Modern tools
    'jq', 'yq', 'xmlstarlet', 'xmllint', 'xsltproc',
    'bat', 'fd', 'fzf', 'tree', 'ncdu', 'exa', 'lsd',
    'tldr', 'cheat',
    // Git read-only commands
    'git',
    // Note: awk/sed need special argument checking
    'awk', 'sed', 'gawk', 'mawk', 'gsed'
]);

// ============================================================================
// Write Command Blacklist
// ============================================================================

const WRITE_FIRST = new Set([
    // File operations
    'rm', 'rmdir', 'unlink', 'shred',
    'mv', 'rename', 'cp', 'install', 'dd',
    'mkdir', 'mkfifo', 'mknod', 'mktemp', 'touch', 'truncate',
    // Permissions
    'chmod', 'chown', 'chgrp', 'umask',
    'ln', 'link', 'symlink',
    'setfacl', 'setfattr', 'chattr',
    // System management
    'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel',
    'passwd', 'chpasswd', 'systemctl', 'service',
    // Package managers
    'apt', 'apt-get', 'dpkg', 'snap', 'yum', 'dnf', 'rpm',
    'pip', 'pip3', 'npm', 'yarn', 'gem', 'cargo', 'pnpm',
    // Build tools
    'make', 'cmake', 'ninja', 'meson',
    // Other dangerous
    'sudo', 'doas', 'su', 'crontab', 'at', 'batch',
    'kill', 'pkill', 'killall', 'tee'
]);

// ============================================================================
// Redirection Detection
// ============================================================================

const REDIR_PATTERNS = [
    /(?:^|\s)(?:>>?|<<?|<<<)\s/,           // Basic redirections (>, >>, <, <<, <<<)
    /(?:^|\s)\d*>&?\d*(?:\s|$)/,            // File descriptor redirections (2>&1, 1>&2, etc)
    /(?:^|\s)&>/                            // Combined stdout/stderr redirect (&>)
];

const REDIR = new RegExp(REDIR_PATTERNS.map(p => p.source).join('|'));

// ============================================================================
// Git Subcommand Detection
// ============================================================================

const GIT_WRITE_SUBCOMMANDS = new Set([
    'add', 'commit', 'push', 'pull', 'merge', 'rebase', 'cherry-pick',
    'reset', 'checkout', 'switch', 'restore', 'branch', 'tag',
    'stash', 'apply', 'pop', 'clean', 'rm', 'mv',
    'submodule', 'clone', 'init', 'config'
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if command arguments indicate write operations
 */
function checkCommandArguments(parts: string[]): boolean {
    if (!parts || parts.length === 0) return true;

    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Check sed for in-place editing
    if (cmd === 'sed' || cmd === 'gsed') {
        for (const arg of args) {
            if (arg.startsWith('-i') || arg === '--in-place') {
                return false;  // sed -i is a write operation
            }
        }
    }

    // Check awk for file output operations
    if (['awk', 'gawk', 'mawk'].includes(cmd)) {
        const script = args.join(' ');
        // Check for output redirection within awk script
        if (script.includes('print >') || script.includes('print >>') ||
            script.includes('printf >') || script.includes('printf >>')) {
            return false;
        }
    }

    // Check find for dangerous operations
    if (cmd === 'find') {
        if (args.includes('-delete')) {
            return false;
        }
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-exec' || args[i] === '-execdir') {
                if (i + 1 < args.length) {
                    const execCmd = args[i + 1].toLowerCase();
                    if (WRITE_FIRST.has(execCmd) || ['rm', 'mv', 'cp', 'shred'].includes(execCmd)) {
                        return false;
                    }
                }
            }
        }
    }

    // Check xargs for dangerous commands
    if (cmd === 'xargs') {
        for (const writeCmd of WRITE_FIRST) {
            if (args.some(arg => arg === writeCmd)) {
                return false;
            }
        }
        // Check for sed -i through xargs
        const sedIndex = args.indexOf('sed');
        if (sedIndex > -1 && sedIndex + 1 < args.length && args[sedIndex + 1].startsWith('-i')) {
            return false;
        }
    }

    // Check git subcommands
    if (cmd === 'git') {
        if (args.length === 0) return true;  // Just 'git' with no args is safe
        const subcommand = args[0].toLowerCase();
        if (GIT_WRITE_SUBCOMMANDS.has(subcommand)) {
            return false;  // git write operation
        }
    }

    return true;
}

/**
 * Simple shell command splitting (handles quotes)
 */
function splitCommand(segment: string): string[] {
    const parts: string[] = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match;

    while ((match = regex.exec(segment)) !== null) {
        parts.push(match[1] || match[2] || match[0]);
    }

    return parts;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Determine if a bash command is read-only (safe to execute in discussion mode)
 *
 * @param command - The bash command to analyze
 * @param extrasafe - If true, unrecognized commands are treated as write-like (default: true)
 * @returns true if command is read-only, false if it performs writes
 */
export function isBashReadOnly(command: string, extrasafe: boolean = true): boolean {
    const s = (command || '').trim();
    if (!s) return true;

    // Check for redirections
    if (REDIR.test(s)) {
        return false;
    }

    // Split on |, && and || (pipeline and logical operators)
    const segments = s.split(/(?<!\|)\|(?!\|)|&&|\|\|/).map(seg => seg.trim());

    for (const segment of segments) {
        if (!segment) continue;

        // Parse command parts (handling quotes)
        let parts: string[];
        try {
            parts = splitCommand(segment);
        } catch (error) {
            // If we can't parse, treat as unsafe
            return !extrasafe;
        }

        if (parts.length === 0) continue;

        const first = parts[0].toLowerCase();

        // cd is always allowed
        if (first === 'cd') continue;

        // Special case: Commands with read-only subcommands
        if (['pip', 'pip3'].includes(first)) {
            const subcommand = parts[1]?.toLowerCase() || '';
            if (['show', 'list', 'search', 'check', 'freeze', 'help'].includes(subcommand)) {
                continue;  // Allow read-only pip operations
            }
            return false;  // Block write operations
        }

        if (['npm', 'yarn', 'pnpm'].includes(first)) {
            const subcommand = parts[1]?.toLowerCase() || '';
            if (['list', 'ls', 'view', 'show', 'search', 'help'].includes(subcommand)) {
                continue;  // Allow read-only npm/yarn/pnpm operations
            }
            return false;  // Block write operations
        }

        if (['python', 'python3'].includes(first)) {
            // Allow python -c for simple expressions
            if (parts.length > 1 && ['-c', '-m'].includes(parts[1])) {
                continue;
            }
            // Block other python invocations as potentially write-like
            return false;
        }

        // Check if command is explicitly in write blacklist
        if (WRITE_FIRST.has(first)) return false;

        // Check command arguments for write operations
        if (!checkCommandArguments(parts)) return false;

        // If extrasafe is on and command not in readonly list, block it
        if (!READONLY_FIRST.has(first) && extrasafe) return false;
    }

    return true;
}
