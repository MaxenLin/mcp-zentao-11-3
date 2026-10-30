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
    const bin = zentaoBin();
    let ok = true;

    for (const host of options.hosts) {
        console.log(installSkill(home, host, source, dryRun));
        if (!register) {
            continue;
        }
        const line = host === 'cursor'
            ? installCursorMcp(home, bin, dryRun)
            : registerHostMcp(host, bin, dryRun);
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

function installCursorMcp(home: string, bin: string, dryRun: boolean): string {
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
    servers.zentao = { command: bin, args: ['mcp'] };
    data.mcpServers = servers;
    if (!dryRun) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode });
    }
    return `${dryRun ? '将写入' : '已写入'} ${file}`;
}

function registerHostMcp(host: Exclude<SetupHost, 'cursor'>, bin: string, dryRun: boolean): string {
    const command = host;
    const args = host === 'claude'
        ? ['mcp', 'add', '--scope', 'user', 'zentao', '--', bin, 'mcp']
        : host === 'grok'
            ? ['mcp', 'add', '--scope', 'user', 'zentao', '--', bin, 'mcp']
            : ['mcp', 'add', 'zentao', '--', bin, 'mcp'];
    const shown = `${command} ${args.join(' ')}`;
    if (!commandExists(command)) {
        return `未找到 ${command}。skill 已安装，MCP 可稍后手动执行: ${shown}`;
    }
    if (dryRun) {
        return `将执行 ${shown}`;
    }
    try {
        execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
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

function zentaoBin(): string {
    return commandPath('zentao') ?? 'zentao';
}

function commandExists(command: string): boolean {
    return commandPath(command) !== undefined;
}

function commandPath(command: string): string | undefined {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of dirs) {
        if (!dir) {
            continue;
        }
        const full = path.join(dir, command);
        try {
            fs.accessSync(full, fs.constants.X_OK);
            return full;
        } catch {
            // 继续找下一个目录
        }
    }
    return undefined;
}
