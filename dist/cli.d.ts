/**
 * 无参数且 stdin 不是终端时保持 MCP。其余情况走命令行。
 */
export declare function shouldRunCli(argv: string[]): boolean;
export declare function runCli(argv: string[]): Promise<void>;
