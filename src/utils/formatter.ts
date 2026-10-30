/**
 * 把需求和 Bug 格式化为 Markdown，供导出使用。
 */

import { Story, Bug } from '../types.js';

/**
 * 格式化需求为 Markdown
 */
export function formatStoryAsMarkdown(story: Story): string {
    const lines: string[] = [];
    
    lines.push(`# 需求 #${story.id}: ${story.title}`);
    lines.push('');
    
    if (story.productName) {
        lines.push(`**产品**: ${story.productName}`);
    }
    if (story.moduleName) {
        lines.push(`**模块**: ${story.moduleName}`);
    }
    if (story.status) {
        lines.push(`**状态**: ${story.status}`);
    }
    if (story.pri) {
        lines.push(`**优先级**: ${story.pri}`);
    }
    if (story.stage) {
        lines.push(`**阶段**: ${story.stage}`);
    }
    if (story.estimate) {
        lines.push(`**预估工时**: ${story.estimate} 小时`);
    }
    if (story.assignedTo) {
        lines.push(`**指派给**: ${story.assignedTo}`);
    }
    if (story.openedBy) {
        lines.push(`**创建人**: ${story.openedBy}`);
    }
    if (story.openedDate) {
        lines.push(`**创建时间**: ${story.openedDate}`);
    }
    
    lines.push('');
    lines.push('## 需求描述');
    lines.push('');
    if (story.spec) {
        lines.push(story.spec);
    } else {
        lines.push('*暂无描述*');
    }
    
    return lines.join('\n');
}

/**
 * 格式化 Bug 为 Markdown
 */
export function formatBugAsMarkdown(bug: Bug): string {
    const lines: string[] = [];
    
    lines.push(`# Bug #${bug.id}: ${bug.title}`);
    lines.push('');
    
    if (bug.productName) {
        lines.push(`**产品**: ${bug.productName}`);
    }
    if (bug.status) {
        lines.push(`**状态**: ${bug.status}`);
    }
    if (bug.severity) {
        lines.push(`**严重程度**: ${bug.severity}`);
    }
    if (bug.openedDate) {
        lines.push(`**创建时间**: ${bug.openedDate}`);
    }
    if (bug.story) {
        lines.push(`**关联需求**: #${bug.story}`);
    }
    
    lines.push('');
    lines.push('## 复现步骤');
    lines.push('');
    if (bug.steps) {
        lines.push(bug.steps);
    } else {
        lines.push('*暂无复现步骤*');
    }
    
    return lines.join('\n');
}
