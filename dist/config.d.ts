export interface ZentaoConfig {
    url: string;
    username: string;
    password: string;
    apiVersion: 'legacy';
}
export declare function saveConfig(config: ZentaoConfig): void;
export declare function getConfigFilePath(): string;
export declare function loadFileConfig(): ZentaoConfig | null;
export declare function loadConfig(): ZentaoConfig | null;
