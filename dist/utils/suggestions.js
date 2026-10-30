/**
 * 操作建议工具
 * 根据当前上下文，建议下一步操作
 */
/**
 * 根据需求上下文生成下一步建议
 */
export function suggestNextActionsForStory(story, hasRelatedBugs, hasTestCases) {
    const suggestions = [];
    // 如果需求是激活状态，建议创建任务
    if (story.status === 'active' || story.status === 'draft') {
        suggestions.push({
            action: '创建开发任务',
            description: `为需求 #${story.id} 创建任务。还需要一个项目编号。`,
            tool: 'createTask',
            toolArgs: { name: story.title, story: story.id, type: 'devel' },
            priority: 'high'
        });
    }
    // 如果有关联 Bug，建议查看
    if (hasRelatedBugs) {
        suggestions.push({
            action: '查看关联 Bug',
            description: `查看需求 #${story.id} 关联的所有 Bug`,
            tool: 'getStoryRelatedBugs',
            toolArgs: { storyId: story.id },
            priority: 'medium'
        });
    }
    // 如果没有测试用例，建议创建
    if (!hasTestCases) {
        suggestions.push({
            action: '创建测试用例',
            description: `为需求 #${story.id} 创建测试用例`,
            tool: 'createTestCase',
            toolArgs: { story: story.id },
            priority: 'medium'
        });
    }
    // 建议生成代码框架
    suggestions.push({
        action: '生成代码框架提示',
        description: `根据需求 #${story.id} 生成代码框架提示`,
        tool: 'generateCodePromptFromStory',
        toolArgs: { storyId: story.id },
        priority: 'medium'
    });
    // 建议分析复杂度
    suggestions.push({
        action: '分析需求复杂度',
        description: `分析需求 #${story.id} 的开发复杂度`,
        tool: 'analyzeStoryComplexity',
        toolArgs: { storyId: story.id },
        priority: 'low'
    });
    return suggestions;
}
/**
 * 根据 Bug 上下文生成下一步建议
 */
export function suggestNextActionsForBug(bug, hasRelatedStory, isActive) {
    const suggestions = [];
    // 如果是激活状态的 Bug，建议创建修复任务
    if (isActive) {
        suggestions.push({
            action: '创建修复任务',
            description: `为 Bug #${bug.id} 创建修复任务。还需要一个项目编号，任务本身不能直接挂在 Bug 上。`,
            tool: 'createTask',
            toolArgs: { name: `修复 ${bug.title}`, type: 'devel', desc: `Bug #${bug.id}` },
            priority: 'high'
        });
    }
    // 建议生成测试用例
    suggestions.push({
        action: '生成测试用例提示',
        description: `根据 Bug #${bug.id} 生成测试用例提示`,
        tool: 'generateTestPromptFromBug',
        toolArgs: { bugId: bug.id },
        priority: 'high'
    });
    // 如果有关联需求，建议查看
    if (hasRelatedStory) {
        suggestions.push({
            action: '查看关联需求',
            description: `查看 Bug #${bug.id} 关联的需求`,
            tool: 'getBugRelatedStory',
            toolArgs: { bugId: bug.id },
            priority: 'medium'
        });
    }
    // 建议分析优先级
    suggestions.push({
        action: '分析 Bug 优先级',
        description: `分析 Bug #${bug.id} 的处理优先级`,
        tool: 'analyzeBugPriority',
        toolArgs: { bugId: bug.id },
        priority: 'medium'
    });
    // 如果 Bug 已解决，建议标记为已解决
    if (bug.status === 'resolved') {
        suggestions.push({
            action: '关闭 Bug',
            description: `将 Bug #${bug.id} 关闭`,
            tool: 'closeBug',
            toolArgs: { bugId: bug.id },
            priority: 'low'
        });
    }
    return suggestions;
}
/**
 * 根据任务上下文生成下一步建议
 */
export function suggestNextActionsForTask(task, isCompleted = false) {
    const suggestions = [];
    // 如果任务是待办状态，建议开始
    if (task.status === 'wait') {
        suggestions.push({
            action: '开始任务',
            description: `开始任务 #${task.id}`,
            tool: 'startTask',
            toolArgs: { taskId: task.id },
            priority: 'high'
        });
    }
    // 如果任务是进行中状态，建议完成
    if (task.status === 'doing') {
        suggestions.push({
            action: '完成任务',
            description: `将任务 #${task.id} 标记为已完成`,
            tool: 'finishTask',
            toolArgs: { taskId: task.id },
            priority: 'high'
        });
    }
    if (task.status === 'done') {
        suggestions.push({
            action: '关闭任务',
            description: `关闭任务 #${task.id}`,
            tool: 'closeTask',
            toolArgs: { taskId: task.id },
            priority: 'medium'
        });
    }
    // 建议分析工作量
    suggestions.push({
        action: '分析任务工作量',
        description: `分析任务 #${task.id} 的工作量`,
        tool: 'analyzeTaskWorkload',
        toolArgs: { taskId: task.id },
        priority: 'low'
    });
    // 如果有关联需求，建议查看
    if (task.story) {
        suggestions.push({
            action: '查看关联需求',
            description: `查看任务 #${task.id} 关联的需求`,
            tool: 'getStoryDetail',
            toolArgs: { storyId: typeof task.story === 'string' ? parseInt(task.story) : task.story },
            priority: 'medium'
        });
    }
    return suggestions;
}
/**
 * 格式化建议为 Markdown
 */
export function formatSuggestionsAsMarkdown(suggestions) {
    if (suggestions.length === 0) {
        return '暂无建议操作。';
    }
    const lines = [];
    lines.push('## 💡 建议下一步操作\n');
    // 按优先级分组
    const highPriority = suggestions.filter(s => s.priority === 'high');
    const mediumPriority = suggestions.filter(s => s.priority === 'medium');
    const lowPriority = suggestions.filter(s => s.priority === 'low');
    const formatGroup = (group, title) => {
        if (group.length === 0)
            return;
        lines.push(`### ${title}\n`);
        group.forEach((suggestion, index) => {
            lines.push(`${index + 1}. **${suggestion.action}**`);
            lines.push(`   - ${suggestion.description}`);
            if (suggestion.tool) {
                lines.push(`   - 工具: \`${suggestion.tool}\``);
            }
            lines.push('');
        });
    };
    if (highPriority.length > 0) {
        formatGroup(highPriority, '🔴 高优先级');
    }
    if (mediumPriority.length > 0) {
        formatGroup(mediumPriority, '🟡 中优先级');
    }
    if (lowPriority.length > 0) {
        formatGroup(lowPriority, '🟢 低优先级');
    }
    lines.push('---\n');
    lines.push('💬 **提示**: 你可以直接告诉我你想执行哪个操作，例如："执行第1个操作"、"创建开发任务"等。\n');
    return lines.join('\n');
}
