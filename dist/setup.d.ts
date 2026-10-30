export declare const SETUP_HOSTS: readonly ["grok", "claude", "codex", "cursor"];
export type SetupHost = (typeof SETUP_HOSTS)[number];
export declare function isSetupHost(value: string): value is SetupHost;
export interface SetupOptions {
    hosts: SetupHost[];
    dryRun?: boolean;
    /** 为 false 时只安装 skill，不登记 MCP。 */
    mcp?: boolean;
    home?: string;
}
export declare function runSetup(options: SetupOptions): boolean;
/** cmd.exe /s /c 会剥掉整行最外层引号。% 即使在引号里也会展开。 */
export declare function windowsCommandLine(file: string, args: string[]): string;
export declare function findOnPath(command: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string | undefined;
