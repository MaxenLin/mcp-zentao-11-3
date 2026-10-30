/**
 * 把需求和 Bug 格式化为 Markdown，供导出使用。
 */
import { Story, Bug } from '../types.js';
/**
 * 格式化需求为 Markdown
 */
export declare function formatStoryAsMarkdown(story: Story): string;
/**
 * 格式化 Bug 为 Markdown
 */
export declare function formatBugAsMarkdown(bug: Bug): string;
