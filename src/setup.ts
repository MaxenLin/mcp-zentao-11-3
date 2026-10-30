import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const SETUP_HOSTS = ['grok', 'claude', 'codex', 'cursor'] as const;
export type SetupHost = (typeof SETUP_HOSTS)[number];

const SKILL_DIR: Record<SetupHost, string> = {
    grok: '.grok/skills/zentao',
    claude: '.claude/skills/zentao',
    codex: '.agents/skills/zentao',
    cursor: '.cursor/skills/zentao'
};

export function isSetupHost(value: string): value is SetupHost {
    return (SETUP_HOSTS as readonly string[]).includes(value);
}

export interface SetupOptions {
    hosts: SetupHost[];
    dryRun?: boolean;
    /** 为 false 时只安装 skill，不登记 MCP。 */
    mcp?: boolean;
    home?: string;
}

export function runSetup(options: SetupOptions): boolean {
    const source = skillSource();
    if (!fs.existsSync(source)) {
        throw new Error(`找不到 skill 文件: ${source}`);
    }
    const home = options.home ?? os.homedir();
    const dryRun = options.dryRun === true;
    const register = options.mcp !== false;
    const launch = mcpLaunch();
    let ok = true;

    for (const host of options.hosts) {
        console.log(installSkill(home, host, source, dryRun));
        if (!register) {
            continue;
        }
        const line = host === 'cursor'
            ? installCursorMcp(home, launch, dryRun)
            : registerHostMcp(host, launch, dryRun);
        console.log(line);
        if ((line.startsWith('登记') && line.includes('失败')) || line.includes('没有改动')) {
            ok = false;
        }
    }

    return ok;
}

function skillSource(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugin/skills/zentao/SKILL.md');
}

function installSkill(home: string, host: SetupHost, source: string, dryRun: boolean): string {
    const dest = path.join(home, SKILL_DIR[host], 'SKILL.md');
    const body = fs.readFileSync(source);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(body)) {
        return `skill 已是最新 ${dest}`;
    }
    if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
    }
    return `${dryRun ? '将安装' : '已安装'} skill ${dest}`;
}

interface McpLaunch {
    command: string;
    args: string[];
}

function installCursorMcp(home: string, launch: McpLaunch, dryRun: boolean): string {
    const file = path.join(home, '.cursor', 'mcp.json');
    let data: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return `跳过 ${file}：内容不是 JSON 对象，没有改动`;
            }
            data = parsed as Record<string, unknown>;
        } catch {
            return `跳过 ${file}：JSON 无法解析，没有改动`;
        }
    }

    const existing = data.mcpServers;
    const servers = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing as Record<string, unknown>
        : {};
    if (servers.zentao) {
        return `已有 Cursor MCP zentao，跳过 ${file}`;
    }
    servers.zentao = { command: launch.command, args: launch.args };
    data.mcpServers = servers;
    if (!dryRun) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode });
    }
    return `${dryRun ? '将写入' : '已写入'} ${file}`;
}

function registerHostMcp(host: Exclude<SetupHost, 'cursor'>, launch: McpLaunch, dryRun: boolean): string {
    const tail = [launch.command, ...launch.args];
    const args = host === 'codex'
        ? ['mcp', 'add', 'zentao', '--', ...tail]
        : ['mcp', 'add', '--scope', 'user', 'zentao', '--', ...tail];
    const executable = findOnPath(host);
    const shown = `${host} ${args.join(' ')}`;
    if (!executable) {
        return `未找到 ${host}。skill 已安装，MCP 可稍后手动执行: ${shown}`;
    }
    if (dryRun) {
        return `将执行 ${executable} ${args.join(' ')}`;
    }
    try {
        runFile(executable, args);
        return `已登记 ${host} MCP`;
    } catch (error) {
        const stderr = error instanceof Error && 'stderr' in error
            ? String((error as { stderr?: string }).stderr || '')
            : '';
        const detail = `${stderr} ${error instanceof Error ? error.message : String(error)}`.trim();
        if (/already exists/i.test(detail)) {
            return `已有 ${host} MCP zentao，跳过`;
        }
        return `登记 ${host} MCP 失败: ${detail}`;
    }
}

/**
 * Windows 上 npm 的命令是 zentao.cmd。Cursor 直接启动 .cmd 会失败，所以改用当前 node 运行 index.js。
 */
function mcpLaunch(): McpLaunch {
    if (process.platform === 'win32') {
        const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
        return { command: process.execPath, args: [script, 'mcp'] };
    }
    return { command: findOnPath('zentao') ?? 'zentao', args: ['mcp'] };
}

/**
 * Node 从 18.20 / 20.12 起禁止直接 spawn .cmd，否则 EINVAL。交给 cmd.exe，并自己转义参数。
 */
function runFile(file: string, args: string[]): void {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
        execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', windowsCommandLine(file, args)], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            windowsHide: true,
        });
        return;
    }
    execFileSync(file, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        windowsHide: true,
    });
}

/** cmd.exe /s /c 会剥掉整行最外层引号。% 即使在引号里也会展开。 */
export function windowsCommandLine(file: string, args: string[]): string {
    return `"${[file, ...args].map(quoteCmdArg).join(' ')}"`;
}

function quoteCmdArg(value: string): string {
    const escaped = value.replace(/%/g, '%%');
    if (escaped.length === 0) {
        return '""';
    }
    if (!/[\s"&|<>^]/.test(escaped)) {
        return escaped;
    }
    return `"${escaped.replace(/"/g, '""')}"`;
}

export function findOnPath(
    command: string,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): string | undefined {
    const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
    // Windows 按 PATHEXT 找 claude.cmd / claude.exe。不带后缀的文件通常不存在。
    const suffixes = platform === 'win32' && path.win32.extname(command) === ''
        ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of dirs) {
        for (const suffix of suffixes) {
            const full = path.join(dir, suffix ? command + suffix : command);
            try {
                if (!fs.statSync(full).isFile()) {
                    continue;
                }
                if (platform !== 'win32') {
                    fs.accessSync(full, fs.constants.X_OK);
                }
                return full;
            } catch {
                // 继续找下一个候选
            }
        }
    }
    return undefined;
}
