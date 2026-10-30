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
