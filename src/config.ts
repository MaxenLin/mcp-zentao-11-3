import fs from 'fs';
import os from 'os';
import path from 'path';

// 定义配置文件路径
const CONFIG_DIR = path.join(os.homedir(), '.zentao');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 配置接口（只支持 legacy）
export interface ZentaoConfig {
    url: string;
    username: string;
    password: string;
    apiVersion: 'legacy';  // 固定为 legacy
}

// 保存配置
export function saveConfig(config: ZentaoConfig): void {
    // 确保配置目录存在
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // 强制设置为 legacy
    const legacyConfig: ZentaoConfig = {
        ...config,
        apiVersion: 'legacy'
    };

    // 写入配置文件。mode 会被 umask 改掉，所以再 chmod 一次。
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(legacyConfig, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(CONFIG_FILE, 0o600);
    } catch {
        // Windows 或不支持 chmod 时保留默认权限
    }
}

export function getConfigFilePath(): string {
    return CONFIG_FILE;
}

export function loadFileConfig(): ZentaoConfig | null {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return null;
        }
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        if (!config?.url || !config?.username || !config?.password) {
            return null;
        }
        return {
            url: config.url,
            username: config.username,
            password: config.password,
            apiVersion: 'legacy'
        };
    } catch (error) {
        console.error('读取配置文件失败:', error);
        return null;
    }
}

// 读取配置（优先从环境变量读取，其次从配置文件）
export function loadConfig(): ZentaoConfig | null {
    // 优先从环境变量读取配置
    const envUrl = process.env.ZENTAO_URL;
    const envUsername = process.env.ZENTAO_USERNAME;
    const envPassword = process.env.ZENTAO_PASSWORD;
    
    if (envUrl && envUsername && envPassword) {
        return {
            url: envUrl,
            username: envUsername,
            password: envPassword,
            apiVersion: 'legacy'
        };
    }
    
    return loadFileConfig();
}

