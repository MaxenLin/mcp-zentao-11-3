#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZentaoLegacyAPI } from './zentaoLegacyApi.js';
import { loadConfig } from './config.js';
import { downloadImages, buildImageContent } from './utils/imageDownloader.js';
import { ZentaoError, ErrorCode, createError } from './errors.js';
import { formatStoryAsMarkdown, formatBugAsMarkdown, formatTaskAsMarkdown, generateStorySummary, generateBugSummary } from './utils/formatter.js';
import { analyzeStoryComplexity, analyzeBugPriority, analyzeTaskWorkload } from './utils/analyzer.js';
import { suggestNextActionsForStory, suggestNextActionsForBug, suggestNextActionsForTask, formatSuggestionsAsMarkdown } from './utils/suggestions.js';
// Create an MCP server
const server = new McpServer({
    name: "Zentao 11.3 Legacy API",
    version: "1.0.0"
});
// Initialize ZentaoAPI instance (只支持 legacy)
let zentaoApi = null;
/**
 * 自动初始化 Zentao API（如果未初始化）
 */
async function ensureInitialized() {
    if (zentaoApi) {
        return; // 已经初始化，直接返回
    }
    // 尝试加载配置并初始化
    const config = loadConfig();
    if (!config) {
        throw createError(ErrorCode.CONFIG_ERROR, "未找到配置信息。请设置环境变量 ZENTAO_URL、ZENTAO_USERNAME、ZENTAO_PASSWORD，或创建配置文件。");
    }
    zentaoApi = new ZentaoLegacyAPI(config);
}
// Add Zentao configuration tool（保留用于手动初始化，但所有工具都会自动初始化）
server.tool("initZentao", {}, async ({}) => {
    await ensureInitialized();
    const config = loadConfig();
    if (!config) {
        throw createError(ErrorCode.CONFIG_ERROR, "No configuration found. Please provide complete Zentao configuration.");
    }
    return {
        content: [{ type: "text", text: JSON.stringify(config, null, 2) }]
    };
});
// Add getConfig tool
server.tool("getConfig", {}, async () => {
    try {
        const config = loadConfig();
        if (!config) {
            throw createError(ErrorCode.CONFIG_ERROR, "No configuration found. Please initialize Zentao first.");
        }
        const safeConfig = {
            ...config,
            password: '***'
        };
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(safeConfig, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
        };
    }
});
// Add getMyTasks tool
server.tool("getMyTasks", {
    status: z.enum(['wait', 'doing', 'done', 'all']).optional()
}, async ({ status }) => {
    await ensureInitialized();
    try {
        // Legacy API 的 getMyTasks 不接受参数，返回所有任务
        const tasks = await zentaoApi.getMyTasks();
        // 如果需要过滤状态，在本地过滤
        let filteredTasks = tasks;
        if (status && status !== 'all') {
            filteredTasks = tasks.filter(task => task.status === status);
        }
        return {
            content: [{ type: "text", text: JSON.stringify(filteredTasks, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取我的任务列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getTaskDetail tool
server.tool("getTaskDetail", {
    taskId: z.number()
}, async ({ taskId }) => {
    await ensureInitialized();
    try {
        const task = await zentaoApi.getTaskDetail(taskId);
        return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取任务 ${taskId} 详情失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getProducts tool
server.tool("getProducts", {}, async () => {
    await ensureInitialized();
    try {
        const products = await zentaoApi.getProducts();
        return {
            content: [{ type: "text", text: JSON.stringify(products, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取产品列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getMyBugs tool
server.tool("getMyBugs", {
    status: z.enum(['active', 'resolved', 'closed', 'all']).optional(),
    productId: z.number().optional()
}, async ({ status, productId }) => {
    await ensureInitialized();
    try {
        // Legacy API 的 getMyBugs 不接受参数，返回所有Bug
        const bugs = await zentaoApi.getMyBugs();
        // 如果需要过滤，在本地过滤
        let filteredBugs = bugs;
        if (status && status !== 'all') {
            filteredBugs = bugs.filter(bug => bug.status === status);
        }
        if (productId) {
            // 注意：Legacy API 返回的 Bug 可能没有 productId 字段，需要从详情获取
            // 这里先简单返回所有，如果需要按产品过滤，需要调用 getBugDetail
        }
        return {
            content: [{ type: "text", text: JSON.stringify(filteredBugs, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取我的 Bug 列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getBugDetail tool
server.tool("getBugDetail", {
    bugId: z.number(),
    downloadImages: z.boolean().optional().default(true)
}, async ({ bugId, downloadImages: shouldDownloadImages = true }) => {
    await ensureInitialized();
    try {
        const bug = await zentaoApi.getBugDetail(bugId);
        const result = {
            ...bug,
            images: [],
            fileIds: [],
            hasImages: false,
            hasFiles: false
        };
        // 提取图片和文件信息
        if (bug.steps) {
            result.images = zentaoApi.extractImageUrls(bug.steps);
            result.fileIds = zentaoApi.extractFileIds(bug.steps);
            result.hasImages = result.images.length > 0;
            result.hasFiles = result.fileIds.length > 0;
        }
        // 下载图片（并行）
        if (shouldDownloadImages && result.images.length > 0) {
            result.downloadedImages = await downloadImages(zentaoApi, result.images, true);
        }
        // 构建返回内容，包含文本和图片
        const content = [
            { type: "text", text: JSON.stringify(result, null, 2) }
        ];
        // 添加图片内容（使用MCP协议的image类型）
        if (result.downloadedImages && result.downloadedImages.length > 0) {
            const imageContent = buildImageContent(result.downloadedImages, 'bug', bugId);
            content.push(...imageContent);
        }
        return {
            content: content
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取 Bug ${bugId} 详情失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add updateTask tool
server.tool("updateTask", {
    taskId: z.number(),
    update: z.object({
        consumed: z.number().optional(),
        left: z.number().optional(),
        status: z.enum(['wait', 'doing', 'done']).optional(),
        finishedDate: z.string().optional(),
        comment: z.string().optional()
    })
}, async ({ taskId, update }) => {
    await ensureInitialized();
    try {
        const task = await zentaoApi.updateTask(taskId, update);
        // 添加操作完成后的建议
        const suggestions = suggestNextActionsForTask(task);
        let resultText = JSON.stringify(task, null, 2);
        if (suggestions.length > 0) {
            const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
            resultText += `\n\n## ✅ 操作完成\n\n任务已成功更新。\n\n${suggestionsMarkdown}`;
        }
        return {
            content: [{ type: "text", text: resultText }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `更新任务失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add finishTask tool
server.tool("finishTask", {
    taskId: z.number(),
    update: z.object({
        consumed: z.number().optional(),
        left: z.number().optional(),
        comment: z.string().optional()
    }).optional()
}, async ({ taskId, update }) => {
    await ensureInitialized();
    try {
        await zentaoApi.finishTask(taskId, update);
        // 获取更新后的任务详情
        const task = await zentaoApi.getTaskDetail(taskId);
        // 添加操作完成后的建议
        const suggestions = suggestNextActionsForTask(task, true);
        let resultText = JSON.stringify(task, null, 2);
        if (suggestions.length > 0) {
            const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
            resultText += `\n\n## ✅ 操作完成\n\n任务已成功完成。\n\n${suggestionsMarkdown}`;
        }
        return {
            content: [{ type: "text", text: resultText }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `完成任务失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add resolveBug tool
server.tool("resolveBug", {
    bugId: z.number(),
    resolution: z.object({
        resolution: z.enum(['fixed', 'notrepro', 'duplicate', 'bydesign', 'willnotfix', 'tostory', 'external']),
        resolvedBuild: z.string().optional(),
        duplicateBug: z.number().optional(),
        comment: z.string().optional()
    })
}, async ({ bugId, resolution }) => {
    await ensureInitialized();
    try {
        await zentaoApi.resolveBug(bugId, resolution);
        const bug = await zentaoApi.getBugDetail(bugId);
        // 添加操作完成后的建议
        const relatedStory = await zentaoApi.getBugRelatedStory(bugId).catch(() => null);
        const suggestions = suggestNextActionsForBug(bug, relatedStory !== null, bug.status === 'active');
        let resultText = JSON.stringify(bug, null, 2);
        if (suggestions.length > 0) {
            const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
            resultText += `\n\n## ✅ 操作完成\n\nBug 已成功解决。\n\n${suggestionsMarkdown}`;
        }
        return {
            content: [{ type: "text", text: resultText }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `解决 Bug 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getProductStories tool
server.tool("getProductStories", {
    productId: z.number(),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional()
}, async ({ productId, status }) => {
    await ensureInitialized();
    try {
        const stories = await zentaoApi.getProductStories(productId, status);
        return {
            content: [{ type: "text", text: JSON.stringify(stories, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取产品 ${productId} 的需求列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getStoryDetail tool
server.tool("getStoryDetail", {
    storyId: z.number(),
    downloadImages: z.boolean().optional().default(true)
}, async ({ storyId, downloadImages: shouldDownloadImages = true }) => {
    await ensureInitialized();
    try {
        const story = await zentaoApi.getStoryDetail(storyId);
        const result = {
            ...story,
            images: [],
            fileIds: [],
            hasImages: false,
            hasFiles: false
        };
        // 提取图片和文件信息
        if (story.spec) {
            result.images = zentaoApi.extractImageUrls(story.spec);
            result.fileIds = zentaoApi.extractFileIds(story.spec);
            result.hasImages = result.images.length > 0;
            result.hasFiles = result.fileIds.length > 0;
        }
        // 下载图片（并行）
        if (shouldDownloadImages && result.images.length > 0) {
            result.downloadedImages = await downloadImages(zentaoApi, result.images, true);
        }
        // 构建返回内容，包含文本和图片
        const content = [
            { type: "text", text: JSON.stringify(result, null, 2) }
        ];
        // 添加图片内容（使用MCP协议的image类型）
        if (result.downloadedImages && result.downloadedImages.length > 0) {
            const imageContent = buildImageContent(result.downloadedImages, 'story', storyId);
            content.push(...imageContent);
        }
        // 添加下一步建议
        const relatedBugs = await zentaoApi.getStoryRelatedBugs(storyId).catch(() => []);
        const testCases = await zentaoApi.getStoryTestCases(storyId).catch(() => []);
        const suggestions = suggestNextActionsForStory(story, relatedBugs.length > 0, testCases.length > 0);
        if (suggestions.length > 0) {
            const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
            content.push({
                type: "text",
                text: `\n\n${suggestionsMarkdown}`
            });
        }
        return {
            content: content
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取需求 ${storyId} 详情失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add searchStories tool
server.tool("searchStories", {
    keyword: z.string(),
    productId: z.number().optional(),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional(),
    limit: z.number().optional().default(20),
    deepSearch: z.boolean().optional().default(false).describe("是否启用深度搜索（获取需求详情以获取完整描述，速度较慢但结果更准确）")
}, async ({ keyword, productId, status, limit = 20, deepSearch = false }) => {
    await ensureInitialized();
    try {
        const stories = await zentaoApi.searchStories(keyword, {
            productId,
            status: status,
            limit,
            deepSearch
        });
        return {
            content: [{ type: "text", text: JSON.stringify(stories, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `搜索需求失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add searchStoriesByProductName tool
server.tool("searchStoriesByProductName", {
    productName: z.string(),
    keyword: z.string(),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional(),
    limit: z.number().optional().default(10)
}, async ({ productName, keyword, status, limit = 10 }) => {
    await ensureInitialized();
    try {
        const results = await zentaoApi.searchStoriesByProductName(productName, keyword, {
            status: status,
            limit
        });
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `按产品名称搜索需求失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 测试用例相关接口 ====================
// Add getProductTestCases tool
server.tool("getProductTestCases", {
    productId: z.number(),
    status: z.enum(['normal', 'blocked', 'investigate', 'all']).optional(),
    moduleId: z.number().optional()
}, async ({ productId, status, moduleId }) => {
    await ensureInitialized();
    try {
        const testCases = await zentaoApi.getProductTestCases(productId, status, moduleId);
        return {
            content: [{ type: "text", text: JSON.stringify(testCases, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取产品 ${productId} 的测试用例失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getTestCaseDetail tool
server.tool("getTestCaseDetail", {
    caseId: z.number()
}, async ({ caseId }) => {
    await ensureInitialized();
    try {
        const testCase = await zentaoApi.getTestCaseDetail(caseId);
        return {
            content: [{ type: "text", text: JSON.stringify(testCase, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取测试用例 ${caseId} 详情失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add createTestCase tool
server.tool("createTestCase", {
    testCase: z.object({
        product: z.number(),
        module: z.number().optional(),
        story: z.number().optional(),
        title: z.string(),
        type: z.string().optional(),
        pri: z.number().optional(),
        precondition: z.string().optional(),
        steps: z.string().optional(),
        status: z.string().optional()
    })
}, async ({ testCase }) => {
    await ensureInitialized();
    try {
        const result = await zentaoApi.createTestCase(testCase);
        return {
            content: [{ type: "text", text: JSON.stringify({ id: result, success: true }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `创建测试用例失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getStoryTestCases tool
server.tool("getStoryTestCases", {
    storyId: z.number()
}, async ({ storyId }) => {
    await ensureInitialized();
    try {
        const testCases = await zentaoApi.getStoryTestCases(storyId);
        return {
            content: [{ type: "text", text: JSON.stringify(testCases, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取需求 ${storyId} 的测试用例失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getTestTasks tool
server.tool("getTestTasks", {
    productId: z.number().optional()
}, async ({ productId }) => {
    await ensureInitialized();
    try {
        const testTasks = await zentaoApi.getTestTasks(productId);
        return {
            content: [{ type: "text", text: JSON.stringify(testTasks, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取测试单列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getTestTaskDetail tool
server.tool("getTestTaskDetail", {
    taskId: z.number()
}, async ({ taskId }) => {
    await ensureInitialized();
    try {
        const testTask = await zentaoApi.getTestTaskDetail(taskId);
        return {
            content: [{ type: "text", text: JSON.stringify(testTask, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取测试单 ${taskId} 详情失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getTestTaskResults tool
server.tool("getTestTaskResults", {
    taskId: z.number()
}, async ({ taskId }) => {
    await ensureInitialized();
    try {
        const results = await zentaoApi.getTestTaskResults(taskId);
        return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取测试单 ${taskId} 的测试结果失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add runTestCase tool
server.tool("runTestCase", {
    taskId: z.number(),
    testRun: z.object({
        caseId: z.number(),
        version: z.number().optional(),
        result: z.enum(['pass', 'fail', 'blocked', 'skipped']),
        steps: z.string().optional(),
        comment: z.string().optional()
    })
}, async ({ taskId, testRun }) => {
    await ensureInitialized();
    try {
        await zentaoApi.runTestCase(taskId, testRun);
        return {
            content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `执行测试用例失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 关联关系查询 ====================
// Add getStoryRelatedBugs tool
server.tool("getStoryRelatedBugs", {
    storyId: z.number()
}, async ({ storyId }) => {
    await ensureInitialized();
    try {
        const bugs = await zentaoApi.getStoryRelatedBugs(storyId);
        return {
            content: [{ type: "text", text: JSON.stringify(bugs, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取需求 ${storyId} 关联的 Bug 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getBugRelatedStory tool
server.tool("getBugRelatedStory", {
    bugId: z.number()
}, async ({ bugId }) => {
    await ensureInitialized();
    try {
        const story = await zentaoApi.getBugRelatedStory(bugId);
        if (!story) {
            return {
                content: [{ type: "text", text: JSON.stringify({ message: `Bug ${bugId} 没有关联的需求` }, null, 2) }]
            };
        }
        return {
            content: [{ type: "text", text: JSON.stringify(story, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取 Bug ${bugId} 关联的需求失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 批量操作 ====================
// Add batchUpdateTasks tool
server.tool("batchUpdateTasks", {
    taskIds: z.array(z.number()),
    update: z.object({
        consumed: z.number().optional(),
        left: z.number().optional(),
        status: z.enum(['wait', 'doing', 'done']).optional(),
        finishedDate: z.string().optional(),
        comment: z.string().optional()
    })
}, async ({ taskIds, update }) => {
    await ensureInitialized();
    try {
        const results = [];
        for (const taskId of taskIds) {
            try {
                const task = await zentaoApi.updateTask(taskId, update);
                results.push({ taskId, success: true, task });
            }
            catch (error) {
                results.push({
                    taskId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        return {
            content: [{ type: "text", text: JSON.stringify({ results, total: taskIds.length, success: results.filter(r => r.success).length }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `批量更新任务失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add batchResolveBugs tool
server.tool("batchResolveBugs", {
    bugIds: z.array(z.number()),
    resolution: z.object({
        resolution: z.enum(['fixed', 'notrepro', 'duplicate', 'bydesign', 'willnotfix', 'tostory', 'external']),
        resolvedBuild: z.string().optional(),
        duplicateBug: z.number().optional(),
        comment: z.string().optional()
    })
}, async ({ bugIds, resolution }) => {
    await ensureInitialized();
    try {
        const results = [];
        for (const bugId of bugIds) {
            try {
                await zentaoApi.resolveBug(bugId, resolution);
                const bug = await zentaoApi.getBugDetail(bugId);
                results.push({ bugId, success: true, bug });
            }
            catch (error) {
                results.push({
                    bugId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        return {
            content: [{ type: "text", text: JSON.stringify({ results, total: bugIds.length, success: results.filter(r => r.success).length }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `批量解决 Bug 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 数据统计 ====================
// Add getMyTaskStatistics tool
server.tool("getMyTaskStatistics", {}, async () => {
    await ensureInitialized();
    try {
        const tasks = await zentaoApi.getMyTasks();
        const statistics = {
            total: tasks.length,
            wait: tasks.filter(t => t.status === 'wait').length,
            doing: tasks.filter(t => t.status === 'doing').length,
            done: tasks.filter(t => t.status === 'done').length,
            byPriority: {
                '1': tasks.filter(t => t.pri === 1).length,
                '2': tasks.filter(t => t.pri === 2).length,
                '3': tasks.filter(t => t.pri === 3).length,
                '4': tasks.filter(t => t.pri === 4).length,
            }
        };
        return {
            content: [{ type: "text", text: JSON.stringify(statistics, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取任务统计失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getMyBugStatistics tool
server.tool("getMyBugStatistics", {}, async () => {
    await ensureInitialized();
    try {
        const bugs = await zentaoApi.getMyBugs();
        const statistics = {
            total: bugs.length,
            active: bugs.filter(b => b.status === 'active').length,
            resolved: bugs.filter(b => b.status === 'resolved').length,
            closed: bugs.filter(b => b.status === 'closed').length,
            bySeverity: {
                '1': bugs.filter(b => b.severity === 1).length,
                '2': bugs.filter(b => b.severity === 2).length,
                '3': bugs.filter(b => b.severity === 3).length,
                '4': bugs.filter(b => b.severity === 4).length,
            }
        };
        return {
            content: [{ type: "text", text: JSON.stringify(statistics, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取 Bug 统计失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== AI 编程辅助功能 ====================
// Add getDevelopmentContext tool - 获取完整开发上下文
server.tool("getDevelopmentContext", {
    entityType: z.enum(['story', 'bug']),
    entityId: z.number(),
    format: z.enum(['json', 'markdown']).optional().default('json')
}, async ({ entityType, entityId, format = 'json' }) => {
    await ensureInitialized();
    try {
        if (entityType === 'story') {
            // 获取需求完整上下文
            const story = await zentaoApi.getStoryDetail(entityId);
            const relatedBugs = await zentaoApi.getStoryRelatedBugs(entityId);
            const testCases = await zentaoApi.getStoryTestCases(entityId);
            const context = {
                story,
                relatedBugs,
                testCases,
                summary: {
                    bugsCount: relatedBugs.length,
                    testCasesCount: testCases.length
                }
            };
            if (format === 'markdown') {
                let markdown = formatStoryAsMarkdown(story);
                markdown += '\n\n## 关联信息\n\n';
                markdown += `- **关联 Bug**: ${relatedBugs.length} 个\n`;
                markdown += `- **测试用例**: ${testCases.length} 个\n\n`;
                if (relatedBugs.length > 0) {
                    markdown += '### 关联的 Bug\n\n';
                    relatedBugs.forEach(bug => {
                        markdown += `- ${generateBugSummary(bug)}\n`;
                    });
                    markdown += '\n';
                }
                // 添加下一步建议
                const suggestions = suggestNextActionsForStory(story, relatedBugs.length > 0, testCases.length > 0);
                if (suggestions.length > 0) {
                    const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
                    markdown += `\n\n${suggestionsMarkdown}`;
                }
                return {
                    content: [{ type: "text", text: markdown }]
                };
            }
            // JSON 格式也添加建议
            const suggestions = suggestNextActionsForStory(story, relatedBugs.length > 0, testCases.length > 0);
            context.suggestions = suggestions;
            return {
                content: [{ type: "text", text: JSON.stringify(context, null, 2) }]
            };
        }
        else {
            // 获取 Bug 完整上下文
            const bug = await zentaoApi.getBugDetail(entityId);
            const relatedStory = await zentaoApi.getBugRelatedStory(entityId);
            const context = {
                bug,
                relatedStory: relatedStory || null,
                summary: {
                    hasRelatedStory: relatedStory !== null
                }
            };
            if (format === 'markdown') {
                let markdown = formatBugAsMarkdown(bug);
                markdown += '\n\n## 关联信息\n\n';
                if (relatedStory) {
                    markdown += '### 关联的需求\n\n';
                    markdown += formatStoryAsMarkdown(relatedStory);
                    markdown += '\n';
                }
                else {
                    markdown += '- **关联需求**: 无\n\n';
                }
                // 添加下一步建议
                const suggestions = suggestNextActionsForBug(bug, relatedStory !== null, bug.status === 'active');
                if (suggestions.length > 0) {
                    const suggestionsMarkdown = formatSuggestionsAsMarkdown(suggestions);
                    markdown += `\n\n${suggestionsMarkdown}`;
                }
                return {
                    content: [{ type: "text", text: markdown }]
                };
            }
            // JSON 格式也添加建议
            const suggestions = suggestNextActionsForBug(bug, relatedStory !== null, bug.status === 'active');
            context.suggestions = suggestions;
            return {
                content: [{ type: "text", text: JSON.stringify(context, null, 2) }]
            };
        }
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取${entityType === 'story' ? '需求' : 'Bug'} ${entityId} 的完整上下文失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add generateStorySummary tool - 生成需求摘要
server.tool("generateStorySummary", {
    storyId: z.number(),
    format: z.enum(['json', 'markdown', 'text']).optional().default('text')
}, async ({ storyId, format = 'text' }) => {
    await ensureInitialized();
    try {
        const story = await zentaoApi.getStoryDetail(storyId);
        if (format === 'markdown') {
            return {
                content: [{ type: "text", text: formatStoryAsMarkdown(story) }]
            };
        }
        else if (format === 'json') {
            return {
                content: [{ type: "text", text: JSON.stringify(story, null, 2) }]
            };
        }
        else {
            return {
                content: [{ type: "text", text: generateStorySummary(story) }]
            };
        }
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `生成需求 ${storyId} 摘要失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add generateBugSummary tool - 生成 Bug 摘要
server.tool("generateBugSummary", {
    bugId: z.number(),
    format: z.enum(['json', 'markdown', 'text']).optional().default('text')
}, async ({ bugId, format = 'text' }) => {
    await ensureInitialized();
    try {
        const bug = await zentaoApi.getBugDetail(bugId);
        if (format === 'markdown') {
            return {
                content: [{ type: "text", text: formatBugAsMarkdown(bug) }]
            };
        }
        else if (format === 'json') {
            return {
                content: [{ type: "text", text: JSON.stringify(bug, null, 2) }]
            };
        }
        else {
            return {
                content: [{ type: "text", text: generateBugSummary(bug) }]
            };
        }
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `生成 Bug ${bugId} 摘要失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add formatTaskAsMarkdown tool - 格式化任务为 Markdown
server.tool("formatTaskAsMarkdown", {
    taskId: z.number()
}, async ({ taskId }) => {
    await ensureInitialized();
    try {
        const task = await zentaoApi.getTaskDetail(taskId);
        return {
            content: [{ type: "text", text: formatTaskAsMarkdown(task) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `格式化任务 ${taskId} 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 智能分析功能 ====================
// Add analyzeStoryComplexity tool
server.tool("analyzeStoryComplexity", {
    storyId: z.number()
}, async ({ storyId }) => {
    await ensureInitialized();
    try {
        const story = await zentaoApi.getStoryDetail(storyId);
        const relatedBugs = await zentaoApi.getStoryRelatedBugs(storyId);
        const testCases = await zentaoApi.getStoryTestCases(storyId);
        const analysis = analyzeStoryComplexity(story, relatedBugs.length, testCases.length);
        return {
            content: [{ type: "text", text: JSON.stringify({
                        storyId,
                        storyTitle: story.title,
                        analysis
                    }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `分析需求 ${storyId} 复杂度失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add analyzeBugPriority tool
server.tool("analyzeBugPriority", {
    bugId: z.number()
}, async ({ bugId }) => {
    await ensureInitialized();
    try {
        const bug = await zentaoApi.getBugDetail(bugId);
        const relatedStory = await zentaoApi.getBugRelatedStory(bugId);
        const analysis = analyzeBugPriority(bug, relatedStory !== null);
        return {
            content: [{ type: "text", text: JSON.stringify({
                        bugId,
                        bugTitle: bug.title,
                        analysis
                    }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `分析 Bug ${bugId} 优先级失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add analyzeTaskWorkload tool
server.tool("analyzeTaskWorkload", {
    taskId: z.number()
}, async ({ taskId }) => {
    await ensureInitialized();
    try {
        const task = await zentaoApi.getTaskDetail(taskId);
        const analysis = analyzeTaskWorkload(task);
        return {
            content: [{ type: "text", text: JSON.stringify({
                        taskId,
                        taskName: task.name,
                        analysis
                    }, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `分析任务 ${taskId} 工作量失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 代码生成提示工具 ====================
// Add generateCodePromptFromStory tool - 根据需求生成代码框架提示
server.tool("generateCodePromptFromStory", {
    storyId: z.number()
}, async ({ storyId }) => {
    await ensureInitialized();
    try {
        const story = await zentaoApi.getStoryDetail(storyId);
        const relatedBugs = await zentaoApi.getStoryRelatedBugs(storyId);
        const testCases = await zentaoApi.getStoryTestCases(storyId);
        const prompt = `# 根据需求生成代码框架

## 需求信息
- **需求 ID**: ${story.id}
- **需求标题**: ${story.title}
- **需求状态**: ${story.status}
- **优先级**: ${story.pri}
- **产品**: ${story.productName || '未知'}

## 需求描述
${story.spec || '暂无描述'}

## 关联信息
- **关联 Bug 数量**: ${relatedBugs.length}
- **测试用例数量**: ${testCases.length}

## 任务
请根据以上需求信息，生成代码框架，包括：
1. 函数/类的基本结构
2. 必要的注释和文档
3. 输入输出参数定义
4. 错误处理逻辑
5. 基本的测试用例框架

请使用清晰的代码结构，并添加必要的注释说明。`;
        return {
            content: [{ type: "text", text: prompt }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `生成代码提示失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add generateTestPromptFromBug tool - 根据 Bug 生成测试用例提示
server.tool("generateTestPromptFromBug", {
    bugId: z.number()
}, async ({ bugId }) => {
    await ensureInitialized();
    try {
        const bug = await zentaoApi.getBugDetail(bugId);
        const relatedStory = await zentaoApi.getBugRelatedStory(bugId);
        const prompt = `# 根据 Bug 生成测试用例

## Bug 信息
- **Bug ID**: ${bug.id}
- **Bug 标题**: ${bug.title}
- **Bug 状态**: ${bug.status}
- **严重程度**: ${bug.severity}
- **产品**: ${bug.productName || '未知'}

## 复现步骤
${bug.steps || '暂无复现步骤'}

${relatedStory ? `## 关联需求
- **需求 ID**: ${relatedStory.id}
- **需求标题**: ${relatedStory.title}
` : ''}

## 任务
请根据以上 Bug 信息，生成测试用例，包括：
1. 测试用例标题
2. 前置条件
3. 测试步骤（基于复现步骤）
4. 预期结果
5. 测试数据准备

请确保测试用例能够覆盖 Bug 的复现场景。`;
        return {
            content: [{ type: "text", text: prompt }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `生成测试提示失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add generateCodeReviewChecklist tool - 生成代码审查检查清单
server.tool("generateCodeReviewChecklist", {
    entityType: z.enum(['story', 'bug']),
    entityId: z.number()
}, async ({ entityType, entityId }) => {
    await ensureInitialized();
    try {
        let entityInfo = '';
        let context = '';
        if (entityType === 'story') {
            const story = await zentaoApi.getStoryDetail(entityId);
            const relatedBugs = await zentaoApi.getStoryRelatedBugs(entityId);
            entityInfo = `需求 #${story.id}: ${story.title}\n需求描述: ${story.spec || '暂无'}`;
            context = `关联 Bug: ${relatedBugs.length} 个`;
        }
        else {
            const bug = await zentaoApi.getBugDetail(entityId);
            const relatedStory = await zentaoApi.getBugRelatedStory(entityId);
            entityInfo = `Bug #${bug.id}: ${bug.title}\n复现步骤: ${bug.steps || '暂无'}`;
            context = relatedStory ? `关联需求: #${relatedStory.id} - ${relatedStory.title}` : '无关联需求';
        }
        const prompt = `# 代码审查检查清单

## ${entityType === 'story' ? '需求' : 'Bug'} 信息
${entityInfo}

## 关联信息
${context}

## 代码审查检查清单

请根据以上${entityType === 'story' ? '需求' : 'Bug'}信息，检查代码是否符合以下要求：

### 功能完整性
- [ ] 代码是否实现了所有需求点？
- [ ] 边界情况是否处理？
- [ ] 错误处理是否完善？

### 代码质量
- [ ] 代码结构是否清晰？
- [ ] 命名是否规范？
- [ ] 注释是否充分？
- [ ] 是否有重复代码？

### 测试覆盖
- [ ] 是否有单元测试？
- [ ] 测试用例是否覆盖主要场景？
- [ ] 边界情况是否有测试？

### 性能和安全
- [ ] 性能是否满足要求？
- [ ] 是否有安全风险？
- [ ] 资源是否正确释放？

请逐项检查，并提供具体的改进建议。`;
        return {
            content: [{ type: "text", text: prompt }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `生成代码审查检查清单失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 获取操作建议工具 ====================
// Add getNextActionSuggestions tool - 获取下一步操作建议
server.tool("getNextActionSuggestions", {
    entityType: z.enum(['story', 'bug', 'task']),
    entityId: z.number()
}, async ({ entityType, entityId }) => {
    await ensureInitialized();
    try {
        let suggestions = [];
        if (entityType === 'story') {
            const story = await zentaoApi.getStoryDetail(entityId);
            const relatedBugs = await zentaoApi.getStoryRelatedBugs(entityId).catch(() => []);
            const testCases = await zentaoApi.getStoryTestCases(entityId).catch(() => []);
            suggestions = suggestNextActionsForStory(story, relatedBugs.length > 0, testCases.length > 0);
        }
        else if (entityType === 'bug') {
            const bug = await zentaoApi.getBugDetail(entityId);
            const relatedStory = await zentaoApi.getBugRelatedStory(entityId);
            suggestions = suggestNextActionsForBug(bug, relatedStory !== null, bug.status === 'active');
        }
        else {
            const task = await zentaoApi.getTaskDetail(entityId);
            suggestions = suggestNextActionsForTask(task);
        }
        const markdown = formatSuggestionsAsMarkdown(suggestions);
        return {
            content: [
                { type: "text", text: JSON.stringify({ suggestions }, null, 2) },
                { type: "text", text: `\n\n${markdown}` }
            ]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取操作建议失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// ==================== 根据需求/Bug创建任务 ====================
// Add createTaskFromStory tool - 根据需求创建任务
server.tool("createTaskFromStory", {
    storyId: z.number(),
    taskName: z.string(),
    estimate: z.number().optional(),
    assignedTo: z.string().optional(),
    desc: z.string().optional()
}, async ({ storyId, taskName, estimate, assignedTo, desc }) => {
    await ensureInitialized();
    try {
        // 获取需求详情
        const story = await zentaoApi.getStoryDetail(storyId);
        // 注意：禅道11.x Legacy API可能不支持直接通过API创建任务
        // 这里提供一个建议和需求信息的组合
        const suggestion = {
            message: "禅道11.x Legacy API可能不支持直接通过API创建任务",
            suggestion: `请通过禅道Web界面为需求 #${storyId} 创建任务`,
            storyInfo: {
                id: story.id,
                title: story.title,
                product: story.productName,
                status: story.status
            },
            taskInfo: {
                name: taskName,
                estimate: estimate,
                assignedTo: assignedTo,
                desc: desc || `基于需求 #${storyId}: ${story.title}`
            },
            manualSteps: [
                `1. 访问禅道Web界面`,
                `2. 打开需求 #${storyId}: ${story.title}`,
                `3. 在需求详情页创建任务`,
                `4. 任务名称: ${taskName}`,
                estimate ? `5. 预估工时: ${estimate} 小时` : '',
                assignedTo ? `6. 指派给: ${assignedTo}` : ''
            ].filter(Boolean)
        };
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        reason: "API不支持",
                        ...suggestion
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `根据需求创建任务失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add createTaskFromBug tool - 根据Bug创建修复任务
server.tool("createTaskFromBug", {
    bugId: z.number(),
    taskName: z.string().optional(),
    estimate: z.number().optional(),
    assignedTo: z.string().optional(),
    desc: z.string().optional()
}, async ({ bugId, taskName, estimate, assignedTo, desc }) => {
    await ensureInitialized();
    try {
        // 获取Bug详情
        const bug = await zentaoApi.getBugDetail(bugId);
        const relatedStory = await zentaoApi.getBugRelatedStory(bugId);
        const defaultTaskName = taskName || `修复Bug #${bugId}: ${bug.title}`;
        // 注意：禅道11.x Legacy API可能不支持直接通过API创建任务
        const suggestion = {
            message: "禅道11.x Legacy API可能不支持直接通过API创建任务",
            suggestion: `请通过禅道Web界面为Bug #${bugId} 创建修复任务`,
            bugInfo: {
                id: bug.id,
                title: bug.title,
                status: bug.status,
                severity: bug.severity,
                product: bug.productName
            },
            relatedStory: relatedStory ? {
                id: relatedStory.id,
                title: relatedStory.title
            } : null,
            taskInfo: {
                name: defaultTaskName,
                estimate: estimate,
                assignedTo: assignedTo,
                desc: desc || `修复Bug #${bugId}: ${bug.title}\n\n复现步骤:\n${bug.steps || '无'}`
            },
            manualSteps: [
                `1. 访问禅道Web界面`,
                `2. 打开Bug #${bugId}: ${bug.title}`,
                `3. 在Bug详情页创建修复任务`,
                `4. 任务名称: ${defaultTaskName}`,
                estimate ? `5. 预估工时: ${estimate} 小时` : '',
                assignedTo ? `6. 指派给: ${assignedTo}` : ''
            ].filter(Boolean)
        };
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        reason: "API不支持",
                        ...suggestion
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `根据Bug创建任务失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport).catch(console.error);
