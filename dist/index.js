#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZentaoLegacyAPI } from './zentaoLegacyApi.js';
import { loadConfig } from './config.js';
import { downloadImages, buildImageContent, saveImagesToDisk } from './utils/imageDownloader.js';
import { ZentaoError, ErrorCode, createError } from './errors.js';
import { formatStoryAsMarkdown, formatBugAsMarkdown, formatTaskAsMarkdown, generateStorySummary, generateBugSummary } from './utils/formatter.js';
import { analyzeStoryComplexity, analyzeBugPriority, analyzeTaskWorkload } from './utils/analyzer.js';
import { suggestNextActionsForStory, suggestNextActionsForBug, suggestNextActionsForTask, formatSuggestionsAsMarkdown } from './utils/suggestions.js';
import fs from 'fs';
import path from 'path';
/**
 * 解析模块链接，提取产品ID和模块ID
 * 支持的链接格式：
 * - product-browse-{productId}--byModule-{moduleId}.html - 产品模块（需求）
 * - testtask-cases-{taskId}-byModule-{moduleId}.html - 测试任务用例模块
 * - testcase-browse-{productId}-byModule-{moduleId}.html - 产品用例模块
 * - bug-browse-{productId}--byModule-{moduleId}.html - Bug模块
 *
 * @param url 链接URL
 * @returns 解析结果 { type: 'story' | 'testcase' | 'bug', productId: number, moduleId: number, taskId?: number }
 */
function parseModuleUrl(url) {
    // 移除协议和域名，只保留路径部分
    const path = url.replace(/^https?:\/\/[^\/]+/, '');
    // 匹配 product-browse-{productId}--byModule-{moduleId}
    const productModuleMatch = path.match(/product-browse-(\d+)--byModule-(\d+)/);
    if (productModuleMatch) {
        return {
            type: 'story',
            productId: parseInt(productModuleMatch[1]),
            moduleId: parseInt(productModuleMatch[2])
        };
    }
    // 匹配 testtask-cases-{taskId}-byModule-{moduleId}
    const testtaskModuleMatch = path.match(/testtask-cases-(\d+)-byModule-(\d+)/);
    if (testtaskModuleMatch) {
        return {
            type: 'testcase',
            productId: 0, // 测试任务用例需要从任务详情获取产品ID
            moduleId: parseInt(testtaskModuleMatch[2]),
            taskId: parseInt(testtaskModuleMatch[1])
        };
    }
    // 匹配 testcase-browse-{productId}-byModule-{moduleId}
    const testcaseModuleMatch = path.match(/testcase-browse-(\d+)-byModule-(\d+)/);
    if (testcaseModuleMatch) {
        return {
            type: 'testcase',
            productId: parseInt(testcaseModuleMatch[1]),
            moduleId: parseInt(testcaseModuleMatch[2])
        };
    }
    // 匹配 bug-browse-{productId}--byModule-{moduleId}
    const bugModuleMatch = path.match(/bug-browse-(\d+)--byModule-(\d+)/);
    if (bugModuleMatch) {
        return {
            type: 'bug',
            productId: parseInt(bugModuleMatch[1]),
            moduleId: parseInt(bugModuleMatch[2])
        };
    }
    return null;
}
/**
 * 解析并准备导出路径
 * @param exportPath 原始导出路径
 * @param format 导出格式
 * @returns { finalPath: string, dir: string, format: 'json' | 'markdown' }
 */
function prepareExportPath(exportPath) {
    // 解析路径，确保是 .md 格式
    let finalPath = exportPath.trim();
    if (!finalPath.toLowerCase().endsWith('.md')) {
        finalPath = finalPath.replace(/\.[^.]*$/, '') + '.md';
    }
    // 将相对路径解析为绝对路径
    finalPath = path.isAbsolute(finalPath)
        ? finalPath
        : path.resolve(process.cwd(), finalPath);
    // 确保目录存在
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return { finalPath, dir };
}
/**
 * 处理并保存图片
 * @param content 内容（story.spec 或 bug.steps）
 * @param dir 导出目录
 * @param entityType 实体类型
 * @param entityId 实体ID
 * @returns 保存的图片信息
 */
async function processAndSaveImages(content, dir, entityType, entityId) {
    if (!content) {
        return [];
    }
    const imageUrls = zentaoApi.extractImageUrls(content);
    if (imageUrls.length === 0) {
        return [];
    }
    const uniqueImageUrls = Array.from(new Set(imageUrls));
    const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
    return await saveImagesToDisk(downloadedImages, dir, entityType, entityId);
}
/**
 * 替换内容中的图片URL为本地路径（用于Markdown）
 * @param content 原始内容
 * @param savedImages 已保存的图片信息
 * @returns 替换后的内容
 */
function replaceImageUrlsInContent(content, savedImages) {
    let result = content;
    savedImages.forEach((savedImg) => {
        if (savedImg.success && result.includes(savedImg.originalUrl)) {
            const relativePathForMarkdown = savedImg.relativePath.replace(/\\/g, '/');
            result = result.replace(new RegExp(savedImg.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), relativePathForMarkdown);
        }
    });
    return result;
}
/**
 * 解析自然语言时间表达式
 * 支持：今年、今年1月、最近3个月、今天、昨天、上个月等
 */
function parseNaturalDate(dateStr) {
    if (!dateStr) {
        return undefined;
    }
    // 如果已经是标准格式（YYYY-MM-DD），直接返回
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        return dateStr;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const date = now.getDate();
    const lowerStr = dateStr.toLowerCase().trim();
    // 今年
    if (lowerStr === '今年' || lowerStr === 'this year') {
        return `${year}-01-01`;
    }
    // 今年X月
    const monthMatch = lowerStr.match(/今年(\d+)月/);
    if (monthMatch) {
        const m = parseInt(monthMatch[1]);
        if (m >= 1 && m <= 12) {
            return `${year}-${String(m).padStart(2, '0')}-01`;
        }
    }
    // 最近N个月
    const monthsMatch = lowerStr.match(/最近(\d+)个月/);
    if (monthsMatch) {
        const months = parseInt(monthsMatch[1]);
        const targetDate = new Date(year, month - months, date);
        return targetDate.toISOString().split('T')[0];
    }
    // 最近N天
    const daysMatch = lowerStr.match(/最近(\d+)天/);
    if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        const targetDate = new Date(year, month, date - days);
        return targetDate.toISOString().split('T')[0];
    }
    // 今天
    if (lowerStr === '今天' || lowerStr === 'today') {
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    }
    // 昨天
    if (lowerStr === '昨天' || lowerStr === 'yesterday') {
        const yesterday = new Date(year, month, date - 1);
        return yesterday.toISOString().split('T')[0];
    }
    // 上个月
    if (lowerStr === '上个月' || lowerStr === 'last month') {
        const lastMonth = new Date(year, month - 1, 1);
        return lastMonth.toISOString().split('T')[0];
    }
    // 如果无法解析，返回原字符串（让后续的日期解析函数处理）
    return dateStr;
}
/**
 * 将模块数据转换为 Markdown 格式
 */
function formatModuleItemsAsMarkdown(result) {
    const { type, productId, moduleId, taskId, items, count } = result;
    let markdown = `# ${type === 'story' ? '需求' : type === 'bug' ? 'Bug' : '测试用例'}列表\n\n`;
    markdown += `**产品ID**: ${productId}\n`;
    markdown += `**模块ID**: ${moduleId}\n`;
    if (taskId) {
        markdown += `**任务ID**: ${taskId}\n`;
    }
    markdown += `**数量**: ${count}\n`;
    markdown += `**导出时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;
    markdown += `---\n\n`;
    if (items.length === 0) {
        markdown += `暂无数据。\n`;
        return markdown;
    }
    items.forEach((item, index) => {
        markdown += `## ${index + 1}. ${item.title || `#${item.id}`}\n\n`;
        markdown += `**ID**: ${item.id}\n`;
        if (item.status) {
            markdown += `**状态**: ${item.status}\n`;
        }
        if (item.pri !== undefined) {
            const priLabels = ['', '低', '中', '高', '紧急'];
            markdown += `**优先级**: ${priLabels[item.pri] || item.pri}\n`;
        }
        if (item.severity !== undefined) {
            const severityLabels = ['', '轻微', '一般', '严重', '致命'];
            markdown += `**严重程度**: ${severityLabels[item.severity] || item.severity}\n`;
        }
        if (item.stage) {
            markdown += `**阶段**: ${item.stage}\n`;
        }
        if (item.estimate !== undefined && item.estimate > 0) {
            markdown += `**预估工时**: ${item.estimate} 小时\n`;
        }
        if (item.openedBy) {
            markdown += `**创建人**: ${item.openedBy}\n`;
        }
        if (item.openedDate) {
            markdown += `**创建时间**: ${item.openedDate}\n`;
        }
        if (item.assignedTo) {
            markdown += `**指派给**: ${item.assignedTo}\n`;
        }
        if (item.steps) {
            markdown += `\n**复现步骤**:\n\n${item.steps}\n\n`;
        }
        if (item.spec && item.spec.trim()) {
            markdown += `\n**描述**:\n\n${item.spec}\n\n`;
        }
        if (item.precondition) {
            markdown += `\n**前置条件**:\n\n${item.precondition}\n\n`;
        }
        if (item.steps && type === 'testcase') {
            markdown += `\n**测试步骤**:\n\n${item.steps}\n\n`;
        }
        markdown += `---\n\n`;
    });
    return markdown;
}
/**
 * 将多模块数据转换为 Markdown 格式（合并到一个文件，按模块分组显示）
 */
function formatMultiModuleItemsAsMarkdown(result) {
    const { type, productId, items, count, moduleGroups, searchConditions } = result;
    let markdown = `# ${type === 'story' ? '需求' : type === 'bug' ? 'Bug' : '测试用例'}列表（多模块合并）\n\n`;
    if (productId) {
        markdown += `**产品ID**: ${productId}\n`;
    }
    markdown += `**模块数量**: ${moduleGroups?.length || 0}\n`;
    markdown += `**总数量**: ${count}\n`;
    markdown += `**导出时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    if (searchConditions) {
        if (searchConditions.startDate || searchConditions.endDate) {
            markdown += `**日期范围**: ${searchConditions.startDate || '不限'} 至 ${searchConditions.endDate || '不限'}\n`;
        }
        if (searchConditions.keyword) {
            markdown += `**搜索关键字**: ${searchConditions.keyword}\n`;
        }
    }
    markdown += `\n---\n\n`;
    if (!moduleGroups || moduleGroups.length === 0) {
        markdown += `暂无数据。\n`;
        return markdown;
    }
    // 按模块分组显示
    moduleGroups.forEach((moduleGroup, moduleIndex) => {
        const { moduleId, moduleName, items: moduleItems } = moduleGroup;
        markdown += `## 模块 ${moduleIndex + 1}: ${moduleName || `模块ID ${moduleId}`} (${moduleItems.length} 条)\n\n`;
        markdown += `**模块ID**: ${moduleId}\n`;
        if (moduleName) {
            markdown += `**模块名称**: ${moduleName}\n`;
        }
        markdown += `**数量**: ${moduleItems.length}\n\n`;
        markdown += `---\n\n`;
        moduleItems.forEach((item, itemIndex) => {
            markdown += `### ${itemIndex + 1}. ${item.title || `#${item.id}`}\n\n`;
            markdown += `**ID**: ${item.id}\n`;
            if (item.status) {
                markdown += `**状态**: ${item.status}\n`;
            }
            if (item.pri !== undefined) {
                const priLabels = ['', '低', '中', '高', '紧急'];
                markdown += `**优先级**: ${priLabels[item.pri] || item.pri}\n`;
            }
            if (item.severity !== undefined) {
                const severityLabels = ['', '轻微', '一般', '严重', '致命'];
                markdown += `**严重程度**: ${severityLabels[item.severity] || item.severity}\n`;
            }
            if (item.stage) {
                markdown += `**阶段**: ${item.stage}\n`;
            }
            if (item.estimate !== undefined && item.estimate > 0) {
                markdown += `**预估工时**: ${item.estimate} 小时\n`;
            }
            if (item.openedBy) {
                markdown += `**创建人**: ${item.openedBy}\n`;
            }
            if (item.openedDate) {
                markdown += `**创建时间**: ${item.openedDate}\n`;
            }
            if (item.assignedTo) {
                markdown += `**指派给**: ${item.assignedTo}\n`;
            }
            if (item.steps) {
                markdown += `\n**复现步骤**:\n\n${item.steps}\n\n`;
            }
            if (item.spec && item.spec.trim()) {
                markdown += `\n**描述**:\n\n${item.spec}\n\n`;
            }
            if (item.precondition) {
                markdown += `\n**前置条件**:\n\n${item.precondition}\n\n`;
            }
            if (item.steps && type === 'testcase') {
                markdown += `\n**测试步骤**:\n\n${item.steps}\n\n`;
            }
            markdown += `---\n\n`;
        });
        markdown += `\n`;
    });
    return markdown;
}
// Create an MCP server
const server = new McpServer({
    name: "Zentao 11.3 Legacy API",
    version: "1.0.0"
});
// Initialize ZentaoAPI instance (只支持 legacy)
let zentaoApi = null;
// 工作空间路径（在初始化时设置）
let workspaceFolder = null;
/**
 * 获取工作空间路径
 * 优先级：环境变量 > 初始化时设置的值 > process.cwd()
 */
function getWorkspaceFolder() {
    // 优先使用环境变量
    const envWorkspace = process.env.VSCODE_WORKSPACE_FOLDER ||
        process.env.CURSOR_WORKSPACE ||
        process.env.WORKSPACE_FOLDER ||
        process.env.ZENTAO_WORKSPACE;
    if (envWorkspace) {
        return envWorkspace;
    }
    // 使用初始化时设置的值
    if (workspaceFolder) {
        return workspaceFolder;
    }
    // 回退到当前工作目录
    return process.cwd();
}
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
// 在服务器启动时初始化工作空间路径（从环境变量读取）
// Cursor IDE 会在启动 MCP 服务器时通过环境变量传递工作空间路径
const initWorkspaceFolder = () => {
    const envWorkspace = process.env.VSCODE_WORKSPACE_FOLDER ||
        process.env.CURSOR_WORKSPACE ||
        process.env.WORKSPACE_FOLDER ||
        process.env.ZENTAO_WORKSPACE;
    if (envWorkspace) {
        workspaceFolder = envWorkspace;
    }
};
// 立即初始化工作空间路径
initWorkspaceFolder();
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
        // 下载图片（并行，带超时控制）
        let downloadedImages = [];
        let imageDownloadStats = { total: 0, success: 0, failed: 0 };
        if (shouldDownloadImages && result.images.length > 0) {
            // 去重图片 URL，避免重复下载
            const uniqueImageUrls = Array.from(new Set(result.images));
            imageDownloadStats.total = uniqueImageUrls.length;
            try {
                // 使用超时控制，即使部分图片超时/失败也能继续
                downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                imageDownloadStats.success = downloadedImages.filter(img => img.success).length;
                imageDownloadStats.failed = downloadedImages.filter(img => !img.success).length;
            }
            catch (error) {
                // 即使下载过程出错，也继续返回结果（可能部分图片已下载成功）
                imageDownloadStats.failed = imageDownloadStats.total;
                console.warn(`图片下载过程中出现错误，但继续返回已成功下载的图片:`, error);
            }
        }
        // 构建返回的 JSON（移除原始图片 URL，避免 Cursor 循环读取）
        const imageInfo = result.images.length > 0
            ? `已找到 ${result.images.length} 张图片，成功下载 ${imageDownloadStats.success} 张${imageDownloadStats.failed > 0 ? `，${imageDownloadStats.failed} 张下载失败或超时` : ''}`
            : [];
        const jsonResult = {
            ...result,
            images: imageInfo,
            downloadedImages: downloadedImages.map((img, idx) => ({
                success: img.success,
                size: img.size,
                mimeType: img.mimeType,
                // 不包含 base64 和 URL，避免 JSON 过大和循环读取
                index: idx + 1,
                error: img.success ? undefined : img.error
            }))
        };
        // 构建返回内容，包含文本和图片
        const content = [
            { type: "text", text: JSON.stringify(jsonResult, null, 2) }
        ];
        // 添加图片内容（使用MCP协议的image类型）
        // 只添加成功下载的图片，失败的图片不会阻塞流程
        if (downloadedImages && downloadedImages.length > 0) {
            const imageContent = buildImageContent(downloadedImages, 'bug', bugId);
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
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional(),
    moduleId: z.number().optional()
}, async ({ productId, status, moduleId }) => {
    await ensureInitialized();
    try {
        const stories = await zentaoApi.getProductStories(productId, status, moduleId);
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
        // 下载图片（并行，带超时控制）
        let downloadedImages = [];
        let imageDownloadStats = { total: 0, success: 0, failed: 0 };
        if (shouldDownloadImages && result.images.length > 0) {
            // 去重图片 URL，避免重复下载
            const uniqueImageUrls = Array.from(new Set(result.images));
            imageDownloadStats.total = uniqueImageUrls.length;
            try {
                // 使用超时控制，即使部分图片超时/失败也能继续
                downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                imageDownloadStats.success = downloadedImages.filter(img => img.success).length;
                imageDownloadStats.failed = downloadedImages.filter(img => !img.success).length;
            }
            catch (error) {
                // 即使下载过程出错，也继续返回结果（可能部分图片已下载成功）
                imageDownloadStats.failed = imageDownloadStats.total;
                console.warn(`图片下载过程中出现错误，但继续返回已成功下载的图片:`, error);
            }
        }
        // 构建返回的 JSON（移除原始图片 URL，避免 Cursor 循环读取）
        const imageInfo = result.images.length > 0
            ? `已找到 ${result.images.length} 张图片，成功下载 ${imageDownloadStats.success} 张${imageDownloadStats.failed > 0 ? `，${imageDownloadStats.failed} 张下载失败或超时` : ''}`
            : [];
        const jsonResult = {
            ...result,
            images: imageInfo,
            downloadedImages: downloadedImages.map((img, idx) => ({
                success: img.success,
                size: img.size,
                mimeType: img.mimeType,
                // 不包含 base64 和 URL，避免 JSON 过大和循环读取
                index: idx + 1,
                error: img.success ? undefined : img.error
            }))
        };
        // 构建返回内容，包含文本和图片
        const content = [
            { type: "text", text: JSON.stringify(jsonResult, null, 2) }
        ];
        // 添加图片内容（使用MCP协议的image类型）
        // 只添加成功下载的图片，失败的图片不会阻塞流程
        if (downloadedImages && downloadedImages.length > 0) {
            const imageContent = buildImageContent(downloadedImages, 'story', storyId);
            content.push(...imageContent);
        }
        // 添加下一步建议（即使图片下载失败，也继续提供建议）
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
    keyword: z.string().describe("搜索关键字，支持中英文，会在需求标题和描述中搜索。例如：'大R促活'、'音视频'、'每日任务'等"),
    productId: z.number().optional().describe("产品ID（可选），如果指定则只搜索该产品的需求"),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional().describe("需求状态（可选）：draft(草稿)、active(激活)、closed(已关闭)、changed(已变更)、all(全部)"),
    limit: z.number().optional().default(20).describe("返回结果数量限制（默认20条）"),
    deepSearch: z.boolean().optional().default(false).describe("是否启用深度搜索（获取需求详情以获取完整描述，速度较慢但结果更准确）"),
    startDate: z.string().optional().describe("开始时间（可选），格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss。用于过滤需求的创建时间，例如：'2024-01-01' 表示2024年1月1日之后的需求。支持自然语言理解：'今年'、'今年1月'、'最近3个月'等"),
    endDate: z.string().optional().describe("结束时间（可选），格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss。用于过滤需求的创建时间，例如：'2024-12-31' 表示2024年12月31日之前的需求。支持自然语言理解：'今年'、'今年12月'、'今天'等")
}, async ({ keyword, productId, status, limit = 20, deepSearch = false, startDate, endDate }) => {
    await ensureInitialized();
    try {
        // 解析自然语言时间表达式（如果 AI 传递的是自然语言）
        const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
        const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
        const stories = await zentaoApi.searchStories(keyword, {
            productId,
            status: status,
            limit,
            deepSearch,
            startDate: parsedStartDate || startDate,
            endDate: parsedEndDate || endDate
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
// Add getProductBugs tool
server.tool("getProductBugs", {
    productId: z.number(),
    status: z.enum(['active', 'resolved', 'closed', 'all']).optional(),
    moduleId: z.number().optional()
}, async ({ productId, status, moduleId }) => {
    await ensureInitialized();
    try {
        const bugs = await zentaoApi.getProductBugs(productId, status, moduleId);
        return {
            content: [{ type: "text", text: JSON.stringify(bugs, null, 2) }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取产品 ${productId} 的 Bug 列表失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add getModuleItems tool - 根据模块链接获取对应的需求、用例或Bug（JSON格式）
server.tool("getModuleItems", {
    url: z.string().describe("模块链接URL，例如：product-browse-245--byModule-1377.html"),
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/stories.json")
}, async ({ url, exportPath }) => {
    await ensureInitialized();
    try {
        const parsed = parseModuleUrl(url);
        if (!parsed) {
            throw createError(ErrorCode.API_ERROR, `无法解析模块链接: ${url}。支持的格式：product-browse-{productId}--byModule-{moduleId}.html, bug-browse-{productId}--byModule-{moduleId}.html, testcase-browse-{productId}-byModule-{moduleId}.html`);
        }
        let result;
        if (parsed.type === 'story') {
            // 获取模块下的需求
            const stories = await zentaoApi.getProductStories(parsed.productId, undefined, parsed.moduleId);
            // 并行获取每个需求的详细信息（包括 spec 内容）
            const detailedStories = await Promise.all(stories.map(async (story) => {
                try {
                    const detail = await zentaoApi.getStoryDetail(story.id);
                    return {
                        ...story,
                        spec: detail.spec || story.spec || ''
                    };
                }
                catch (error) {
                    // 如果获取详情失败，使用列表数据
                    return story;
                }
            }));
            result = {
                type: 'story',
                productId: parsed.productId,
                moduleId: parsed.moduleId,
                items: detailedStories,
                count: detailedStories.length
            };
        }
        else if (parsed.type === 'testcase') {
            // 获取模块下的用例
            if (parsed.taskId) {
                // 测试任务的用例模块，需要先获取任务详情获取产品ID
                const task = await zentaoApi.getTaskDetail(parsed.taskId);
                if (task.product) {
                    const productId = typeof task.product === 'string' ? parseInt(task.product) : task.product;
                    const testCases = await zentaoApi.getProductTestCases(productId, undefined, parsed.moduleId);
                    result = {
                        type: 'testcase',
                        productId: productId,
                        moduleId: parsed.moduleId,
                        taskId: parsed.taskId,
                        items: testCases,
                        count: testCases.length
                    };
                }
                else {
                    throw createError(ErrorCode.API_ERROR, `无法从任务 ${parsed.taskId} 获取产品ID`);
                }
            }
            else if (parsed.productId > 0) {
                const testCases = await zentaoApi.getProductTestCases(parsed.productId, undefined, parsed.moduleId);
                result = {
                    type: 'testcase',
                    productId: parsed.productId,
                    moduleId: parsed.moduleId,
                    items: testCases,
                    count: testCases.length
                };
            }
            else {
                throw createError(ErrorCode.API_ERROR, `无法确定产品ID`);
            }
        }
        else if (parsed.type === 'bug') {
            // 获取模块下的Bug
            const bugs = await zentaoApi.getProductBugs(parsed.productId, undefined, parsed.moduleId);
            // 获取每个 Bug 的详细信息（包括 steps 中的图片）
            const detailedBugs = await Promise.all(bugs.map(async (bug) => {
                try {
                    const detail = await zentaoApi.getBugDetail(bug.id);
                    return {
                        ...bug,
                        steps: detail.steps || bug.steps || ''
                    };
                }
                catch (error) {
                    return bug;
                }
            }));
            // 收集所有图片 URL
            const allImageUrls = [];
            detailedBugs.forEach(bug => {
                if (bug.steps) {
                    const imageUrls = zentaoApi.extractImageUrls(bug.steps);
                    allImageUrls.push(...imageUrls);
                }
            });
            // 下载并保存所有图片
            let allSavedImages = [];
            if (allImageUrls.length > 0) {
                const uniqueImageUrls = Array.from(new Set(allImageUrls));
                const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                // 将相对路径解析为绝对路径
                const finalPath = path.isAbsolute(exportPath.trim())
                    ? exportPath.trim()
                    : path.resolve(process.cwd(), exportPath.trim());
                const dir = path.dirname(finalPath);
                // 保存图片到本地
                allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'bug', parsed.productId);
                // 为每个 Bug 添加图片信息
                detailedBugs.forEach((bug) => {
                    if (bug.steps) {
                        const bugImageUrls = zentaoApi.extractImageUrls(bug.steps);
                        const bugImages = allSavedImages.filter(img => bugImageUrls.includes(img.originalUrl));
                        bug.images = bugImages.map(img => ({
                            originalUrl: img.originalUrl,
                            localPath: img.localPath,
                            relativePath: img.relativePath,
                            success: img.success,
                            error: img.error
                        }));
                    }
                });
            }
            result = {
                type: 'bug',
                productId: parsed.productId,
                moduleId: parsed.moduleId,
                items: detailedBugs,
                count: detailedBugs.length,
                images: {
                    total: allSavedImages.length,
                    success: allSavedImages.filter(img => img.success).length,
                    failed: allSavedImages.filter(img => !img.success).length
                }
            };
        }
        // 导出到文件（必填，必须传入有效路径）
        if (!exportPath || exportPath.trim() === '') {
            throw createError(ErrorCode.API_ERROR, "导出文件路径不能为空，请指定有效的绝对路径，例如：D:/exports/stories.json");
        }
        // 将相对路径解析为绝对路径（基于当前工作目录）
        const finalPath = path.isAbsolute(exportPath.trim())
            ? exportPath.trim()
            : path.resolve(process.cwd(), exportPath.trim());
        // 确保目录存在
        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // 保存文件（JSON格式）
        fs.writeFileSync(finalPath, JSON.stringify(result, null, 2), 'utf-8');
        const savedPath = finalPath;
        const responseText = JSON.stringify({
            ...result,
            exportedTo: savedPath
        }, null, 2);
        return {
            content: [{ type: "text", text: responseText }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `获取模块数据失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add exportModuleItemsAsMarkdown tool - 根据模块链接导出需求、用例或Bug为Markdown格式
server.tool("exportModuleItemsAsMarkdown", {
    url: z.string().describe("模块链接URL，例如：product-browse-245--byModule-1377.html"),
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/stories.md")
}, async ({ url, exportPath }) => {
    await ensureInitialized();
    try {
        const parsed = parseModuleUrl(url);
        if (!parsed) {
            throw createError(ErrorCode.API_ERROR, `无法解析模块链接: ${url}。支持的格式：product-browse-{productId}--byModule-{moduleId}.html, bug-browse-{productId}--byModule-{moduleId}.html, testcase-browse-{productId}-byModule-{moduleId}.html`);
        }
        let result;
        if (parsed.type === 'story') {
            // 获取模块下的需求
            const stories = await zentaoApi.getProductStories(parsed.productId, undefined, parsed.moduleId);
            // 并行获取每个需求的详细信息（包括 spec 内容）
            const detailedStories = await Promise.all(stories.map(async (story) => {
                try {
                    const detail = await zentaoApi.getStoryDetail(story.id);
                    return {
                        ...story,
                        spec: detail.spec || story.spec || ''
                    };
                }
                catch (error) {
                    // 如果获取详情失败，使用列表数据
                    return story;
                }
            }));
            // 收集所有图片 URL
            const allImageUrls = [];
            detailedStories.forEach(story => {
                if (story.spec) {
                    const imageUrls = zentaoApi.extractImageUrls(story.spec);
                    allImageUrls.push(...imageUrls);
                }
            });
            // 下载并保存所有图片
            let allSavedImages = [];
            if (allImageUrls.length > 0) {
                const uniqueImageUrls = Array.from(new Set(allImageUrls));
                const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                // 将相对路径解析为绝对路径
                let finalPath = exportPath.trim();
                if (!finalPath.toLowerCase().endsWith('.md')) {
                    finalPath = finalPath.replace(/\.[^.]*$/, '') + '.md';
                }
                finalPath = path.isAbsolute(finalPath)
                    ? finalPath
                    : path.resolve(process.cwd(), finalPath);
                const dir = path.dirname(finalPath);
                // 保存图片到本地
                allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'story', parsed.productId);
                // 替换每个需求 spec 中的图片 URL 为本地路径
                detailedStories.forEach((story) => {
                    if (story.spec && allSavedImages.length > 0) {
                        allSavedImages.forEach((savedImg) => {
                            if (savedImg.success && story.spec && story.spec.includes(savedImg.originalUrl)) {
                                const relativePathForMarkdown = savedImg.relativePath.replace(/\\/g, '/');
                                story.spec = story.spec.replace(new RegExp(savedImg.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), relativePathForMarkdown);
                            }
                        });
                    }
                });
            }
            result = {
                type: 'story',
                productId: parsed.productId,
                moduleId: parsed.moduleId,
                items: detailedStories,
                count: detailedStories.length,
                images: {
                    total: allSavedImages.length,
                    success: allSavedImages.filter(img => img.success).length,
                    failed: allSavedImages.filter(img => !img.success).length
                }
            };
        }
        else if (parsed.type === 'testcase') {
            // 获取模块下的用例
            if (parsed.taskId) {
                // 测试任务的用例模块，需要先获取任务详情获取产品ID
                const task = await zentaoApi.getTaskDetail(parsed.taskId);
                if (task.product) {
                    const productId = typeof task.product === 'string' ? parseInt(task.product) : task.product;
                    const testCases = await zentaoApi.getProductTestCases(productId, undefined, parsed.moduleId);
                    result = {
                        type: 'testcase',
                        productId: productId,
                        moduleId: parsed.moduleId,
                        taskId: parsed.taskId,
                        items: testCases,
                        count: testCases.length
                    };
                }
                else {
                    throw createError(ErrorCode.API_ERROR, `无法从任务 ${parsed.taskId} 获取产品ID`);
                }
            }
            else if (parsed.productId > 0) {
                const testCases = await zentaoApi.getProductTestCases(parsed.productId, undefined, parsed.moduleId);
                result = {
                    type: 'testcase',
                    productId: parsed.productId,
                    moduleId: parsed.moduleId,
                    items: testCases,
                    count: testCases.length
                };
            }
            else {
                throw createError(ErrorCode.API_ERROR, `无法确定产品ID`);
            }
        }
        else if (parsed.type === 'bug') {
            // 获取模块下的Bug
            const bugs = await zentaoApi.getProductBugs(parsed.productId, undefined, parsed.moduleId);
            // 获取每个 Bug 的详细信息（包括 steps 中的图片）
            const detailedBugs = await Promise.all(bugs.map(async (bug) => {
                try {
                    const detail = await zentaoApi.getBugDetail(bug.id);
                    return {
                        ...bug,
                        steps: detail.steps || bug.steps || ''
                    };
                }
                catch (error) {
                    return bug;
                }
            }));
            // 收集所有图片 URL
            const allImageUrls = [];
            detailedBugs.forEach(bug => {
                if (bug.steps) {
                    const imageUrls = zentaoApi.extractImageUrls(bug.steps);
                    allImageUrls.push(...imageUrls);
                }
            });
            // 下载并保存所有图片
            let allSavedImages = [];
            if (allImageUrls.length > 0) {
                const uniqueImageUrls = Array.from(new Set(allImageUrls));
                const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                // 将相对路径解析为绝对路径
                let finalPath = exportPath.trim();
                if (!finalPath.toLowerCase().endsWith('.md')) {
                    finalPath = finalPath.replace(/\.[^.]*$/, '') + '.md';
                }
                finalPath = path.isAbsolute(finalPath)
                    ? finalPath
                    : path.resolve(process.cwd(), finalPath);
                const dir = path.dirname(finalPath);
                // 保存图片到本地
                allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'bug', parsed.productId);
                // 替换每个 Bug steps 中的图片 URL 为本地路径
                detailedBugs.forEach((bug) => {
                    if (bug.steps && allSavedImages.length > 0) {
                        allSavedImages.forEach((savedImg) => {
                            if (savedImg.success && bug.steps && bug.steps.includes(savedImg.originalUrl)) {
                                const relativePathForMarkdown = savedImg.relativePath.replace(/\\/g, '/');
                                bug.steps = bug.steps.replace(new RegExp(savedImg.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), relativePathForMarkdown);
                            }
                        });
                    }
                });
            }
            result = {
                type: 'bug',
                productId: parsed.productId,
                moduleId: parsed.moduleId,
                items: detailedBugs,
                count: detailedBugs.length,
                images: {
                    total: allSavedImages.length,
                    success: allSavedImages.filter(img => img.success).length,
                    failed: allSavedImages.filter(img => !img.success).length
                }
            };
        }
        // 导出到文件（必填，必须传入有效路径）
        if (!exportPath || exportPath.trim() === '') {
            throw createError(ErrorCode.API_ERROR, "导出文件路径不能为空，请指定有效的绝对路径，例如：D:/exports/stories.md");
        }
        let finalPath = exportPath.trim();
        // 如果路径没有 .md 扩展名，自动添加
        if (!finalPath.toLowerCase().endsWith('.md')) {
            // 移除现有扩展名（如果有），添加 .md
            finalPath = finalPath.replace(/\.[^.]*$/, '') + '.md';
        }
        // 将相对路径解析为绝对路径（基于当前工作目录）
        finalPath = path.isAbsolute(finalPath)
            ? finalPath
            : path.resolve(process.cwd(), finalPath);
        // 确保目录存在
        const dir = path.dirname(finalPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // 转换为 Markdown 并保存文件
        const markdownContent = formatModuleItemsAsMarkdown(result);
        fs.writeFileSync(finalPath, markdownContent, 'utf-8');
        const savedPath = finalPath;
        const responseText = JSON.stringify({
            ...result,
            exportedTo: savedPath,
            format: 'markdown'
        }, null, 2);
        return {
            content: [{ type: "text", text: responseText }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `导出模块数据为Markdown失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add exportItems tool - 统一导出接口（支持单个和批量导出）
server.tool("exportItems", {
    type: z.enum(['story', 'bug', 'testcase']).describe("导出类型：story(需求)、bug(Bug)、testcase(测试用例)"),
    // 单个导出参数
    id: z.number().optional().describe("单个导出：指定要导出的ID（storyId/bugId/testCaseId）"),
    // 批量导出参数（模块链接）
    url: z.string().optional().describe("批量导出（模块）：模块链接URL，例如：product-browse-245--byModule-1377.html"),
    // 批量导出参数（搜索条件）
    keyword: z.string().optional().describe("批量导出（搜索）：搜索关键字，支持中英文，会在标题和描述中搜索"),
    productId: z.number().optional().describe("产品ID（可选），用于搜索或模块导出"),
    productName: z.string().optional().describe("产品名称（可选），用于搜索"),
    moduleId: z.number().optional().describe("模块ID（可选），用于模块导出"),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all', 'normal', 'blocked', 'investigate', 'resolved']).optional().describe("状态过滤（可选），根据type不同支持不同状态"),
    startDate: z.string().optional().describe("开始时间（可选），格式：YYYY-MM-DD 或自然语言。例如：'2024-01-01'、'今年'、'今年1月'、'最近3个月'等"),
    endDate: z.string().optional().describe("结束时间（可选），格式：YYYY-MM-DD 或自然语言。例如：'2024-12-31'、'今年'、'今年12月'、'今天'等"),
    limit: z.number().optional().default(100).describe("批量导出数量限制（默认100条）"),
    // 通用参数
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/story_2709.md 或 D:/exports/stories.md")
}, async ({ type, id, url, keyword, productId, productName, moduleId, status, startDate, endDate, limit = 100, exportPath }) => {
    await ensureInitialized();
    try {
        // 使用公共函数准备导出路径
        const { finalPath: baseFinalPath, dir } = prepareExportPath(exportPath);
        let finalPath = baseFinalPath; // 允许后续修改
        let result;
        let allSavedImages = [];
        // 判断导出模式：单个导出
        if (id) {
            if (type === 'story') {
                const story = await zentaoApi.getStoryDetail(id);
                // 使用公共函数处理图片
                allSavedImages = await processAndSaveImages(story.spec, dir, 'story', id);
                // 导出文件（Markdown 格式）
                let markdownContent = formatStoryAsMarkdown(story);
                if (story.spec && allSavedImages.length > 0) {
                    markdownContent = replaceImageUrlsInContent(markdownContent, allSavedImages);
                }
                fs.writeFileSync(finalPath, markdownContent, 'utf-8');
                result = {
                    type: 'story',
                    mode: 'single',
                    id: id,
                    count: 1,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
            }
            else if (type === 'bug') {
                const bug = await zentaoApi.getBugDetail(id);
                // 使用公共函数处理图片
                allSavedImages = await processAndSaveImages(bug.steps, dir, 'bug', id);
                // 导出文件（Markdown 格式）
                let markdownContent = formatBugAsMarkdown(bug);
                if (bug.steps && allSavedImages.length > 0) {
                    markdownContent = replaceImageUrlsInContent(markdownContent, allSavedImages);
                }
                fs.writeFileSync(finalPath, markdownContent, 'utf-8');
                result = {
                    type: 'bug',
                    mode: 'single',
                    id: id,
                    count: 1,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
            }
            else {
                throw createError(ErrorCode.API_ERROR, `单个导出测试用例暂不支持，请使用批量导出`);
            }
        }
        // 批量导出：模块链接
        else if (url) {
            const parsed = parseModuleUrl(url);
            if (!parsed) {
                throw createError(ErrorCode.API_ERROR, `无法解析模块链接: ${url}。支持的格式：product-browse-{productId}--byModule-{moduleId}.html, bug-browse-{productId}--byModule-{moduleId}.html, testcase-browse-{productId}-byModule-{moduleId}.html`);
            }
            // 复用 getModuleItems 的逻辑
            if (parsed.type === 'story') {
                const stories = await zentaoApi.getProductStories(parsed.productId, undefined, parsed.moduleId);
                const detailedStories = await Promise.all(stories.map(async (story) => {
                    try {
                        const detail = await zentaoApi.getStoryDetail(story.id);
                        return {
                            ...story,
                            spec: detail.spec || story.spec || ''
                        };
                    }
                    catch (error) {
                        return story;
                    }
                }));
                // 收集并下载图片（批量处理）
                const allImageUrls = [];
                detailedStories.forEach(story => {
                    if (story.spec) {
                        const imageUrls = zentaoApi.extractImageUrls(story.spec);
                        allImageUrls.push(...imageUrls);
                    }
                });
                if (allImageUrls.length > 0) {
                    const uniqueImageUrls = Array.from(new Set(allImageUrls));
                    const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                    allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'story', parsed.productId);
                    // 处理图片：为每个需求分配对应的图片
                    detailedStories.forEach((story) => {
                        if (story.spec && allSavedImages.length > 0) {
                            const storyImageUrls = zentaoApi.extractImageUrls(story.spec);
                            const storyImages = allSavedImages.filter(img => storyImageUrls.includes(img.originalUrl));
                            // Markdown格式：替换URL
                            story.spec = replaceImageUrlsInContent(story.spec, storyImages);
                        }
                    });
                }
                result = {
                    type: 'story',
                    mode: 'batch',
                    source: 'module',
                    productId: parsed.productId,
                    moduleId: parsed.moduleId,
                    items: detailedStories,
                    count: detailedStories.length,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
            }
            else if (parsed.type === 'bug') {
                const bugs = await zentaoApi.getProductBugs(parsed.productId, undefined, parsed.moduleId);
                const detailedBugs = await Promise.all(bugs.map(async (bug) => {
                    try {
                        const detail = await zentaoApi.getBugDetail(bug.id);
                        return {
                            ...bug,
                            steps: detail.steps || bug.steps || ''
                        };
                    }
                    catch (error) {
                        return bug;
                    }
                }));
                // 收集并下载图片（批量处理）
                const allImageUrls = [];
                detailedBugs.forEach(bug => {
                    if (bug.steps) {
                        const imageUrls = zentaoApi.extractImageUrls(bug.steps);
                        allImageUrls.push(...imageUrls);
                    }
                });
                if (allImageUrls.length > 0) {
                    const uniqueImageUrls = Array.from(new Set(allImageUrls));
                    const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                    allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'bug', parsed.productId);
                    // 处理图片：为每个Bug分配对应的图片
                    detailedBugs.forEach((bug) => {
                        if (bug.steps && allSavedImages.length > 0) {
                            const bugImageUrls = zentaoApi.extractImageUrls(bug.steps);
                            const bugImages = allSavedImages.filter(img => bugImageUrls.includes(img.originalUrl));
                            // Markdown格式：替换URL
                            bug.steps = replaceImageUrlsInContent(bug.steps, bugImages);
                        }
                    });
                }
                result = {
                    type: 'bug',
                    mode: 'batch',
                    source: 'module',
                    productId: parsed.productId,
                    moduleId: parsed.moduleId,
                    items: detailedBugs,
                    count: detailedBugs.length,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
            }
            else {
                throw createError(ErrorCode.API_ERROR, `模块导出测试用例暂不支持`);
            }
            // 保存文件（Markdown 格式）
            const markdownContent = formatModuleItemsAsMarkdown(result);
            fs.writeFileSync(finalPath, markdownContent, 'utf-8');
        }
        // 批量导出：搜索条件（包括仅日期范围）
        else if (keyword || productId || productName || moduleId || startDate || endDate) {
            if (type !== 'story') {
                throw createError(ErrorCode.API_ERROR, `搜索导出目前只支持需求（story）类型`);
            }
            // 复用 exportStoriesBySearch 的逻辑
            let finalProductId = productId;
            if (productName && !productId) {
                const products = await zentaoApi.getProducts();
                const matchedProduct = products.find(p => p.name.includes(productName));
                if (matchedProduct) {
                    finalProductId = matchedProduct.id;
                }
                else {
                    throw createError(ErrorCode.API_ERROR, `未找到产品名称包含"${productName}"的产品`);
                }
            }
            let stories = [];
            if (keyword) {
                const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
                const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
                const searchResults = await zentaoApi.searchStories(keyword, {
                    productId: finalProductId,
                    status: status,
                    limit,
                    deepSearch: true,
                    startDate: parsedStartDate || startDate,
                    endDate: parsedEndDate || endDate
                });
                stories = searchResults;
            }
            else if (finalProductId || moduleId) {
                stories = await zentaoApi.getProductStories(finalProductId || 0, status, moduleId);
                if (startDate || endDate) {
                    const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
                    const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
                    stories = stories.filter(story => {
                        if (!story.openedDate)
                            return false;
                        const storyDate = story.openedDate.split(' ')[0];
                        if (parsedStartDate && storyDate < parsedStartDate)
                            return false;
                        if (parsedEndDate && storyDate > parsedEndDate)
                            return false;
                        return true;
                    });
                }
                stories = stories.slice(0, limit);
            }
            else if (startDate || endDate) {
                // 仅按日期范围导出：获取所有产品的需求
                const products = await zentaoApi.getProducts();
                const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
                const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
                // 优化：分批并发获取所有产品的需求（避免一次性并发太多）
                const PRODUCT_BATCH_SIZE = 10; // 每批处理10个产品
                const allStoriesArrays = [];
                for (let i = 0; i < products.length; i += PRODUCT_BATCH_SIZE) {
                    const productBatch = products.slice(i, i + PRODUCT_BATCH_SIZE);
                    const batchPromises = productBatch.map(product => zentaoApi.getProductStories(product.id, status, moduleId));
                    const batchResults = await Promise.allSettled(batchPromises);
                    batchResults.forEach((result) => {
                        if (result.status === 'fulfilled') {
                            allStoriesArrays.push(...result.value);
                        }
                    });
                }
                stories = allStoriesArrays;
                // 按日期过滤
                stories = stories.filter(story => {
                    if (!story.openedDate)
                        return false;
                    const storyDate = story.openedDate.split(' ')[0];
                    if (parsedStartDate && storyDate < parsedStartDate)
                        return false;
                    if (parsedEndDate && storyDate > parsedEndDate)
                        return false;
                    return true;
                });
                stories = stories.slice(0, limit);
            }
            else {
                throw createError(ErrorCode.API_ERROR, "必须指定关键字、产品ID、产品名称、模块ID或日期范围中的至少一个");
            }
            // 获取详细信息（包含模块信息）- 使用分批并发优化性能
            const BATCH_SIZE = 20; // 每批并发20个请求
            const detailedStories = [];
            for (let i = 0; i < stories.length; i += BATCH_SIZE) {
                const batch = stories.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.allSettled(batch.map(async (story) => {
                    try {
                        const detail = await zentaoApi.getStoryDetail(story.id);
                        return {
                            ...story,
                            spec: detail.spec || story.spec || '',
                            module: detail.module || story.module || '0',
                            moduleName: detail.moduleName || story.moduleName
                        };
                    }
                    catch (error) {
                        return {
                            ...story,
                            module: story.module || '0'
                        };
                    }
                }));
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        detailedStories.push(result.value);
                    }
                    else {
                        // 失败时使用原始数据
                        detailedStories.push({
                            ...batch[index],
                            module: batch[index].module || '0'
                        });
                    }
                });
            }
            // 按模块分组
            const moduleGroups = new Map();
            detailedStories.forEach(story => {
                const moduleId = story.module || '0';
                if (!moduleGroups.has(moduleId)) {
                    moduleGroups.set(moduleId, []);
                }
                moduleGroups.get(moduleId).push(story);
            });
            // 按模块分组导出（保持分开）
            if (moduleGroups.size === 1) {
                const [moduleId, moduleStories] = Array.from(moduleGroups.entries())[0];
                // 收集并下载图片
                const allImageUrls = [];
                moduleStories.forEach(story => {
                    if (story.spec) {
                        const imageUrls = zentaoApi.extractImageUrls(story.spec);
                        allImageUrls.push(...imageUrls);
                    }
                });
                if (allImageUrls.length > 0) {
                    const uniqueImageUrls = Array.from(new Set(allImageUrls));
                    const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                    allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'story', finalProductId || 0);
                    // 处理图片
                    moduleStories.forEach((story) => {
                        if (story.spec && allSavedImages.length > 0) {
                            const storyImageUrls = zentaoApi.extractImageUrls(story.spec);
                            const storyImages = allSavedImages.filter(img => storyImageUrls.includes(img.originalUrl));
                            // Markdown格式：替换URL
                            story.spec = replaceImageUrlsInContent(story.spec, storyImages);
                        }
                    });
                }
                result = {
                    type: 'story',
                    mode: 'batch',
                    source: 'search',
                    productId: finalProductId || null,
                    moduleId: typeof moduleId === 'number' ? moduleId : parseInt(moduleId.toString()) || null,
                    searchConditions: {
                        keyword: keyword || null,
                        productId: finalProductId || null,
                        productName: productName || null,
                        moduleId: moduleId || null,
                        status: status || null,
                        startDate: startDate || null,
                        endDate: endDate || null
                    },
                    items: moduleStories,
                    count: moduleStories.length,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
                // 保存文件（Markdown 格式）
                const markdownContent = formatModuleItemsAsMarkdown(result);
                fs.writeFileSync(finalPath, markdownContent, 'utf-8');
            }
            else {
                // 多个模块，并发处理每个模块的导出
                const exportedFiles = [];
                const basePath = finalPath.replace(/\.md$/i, '');
                const baseDir = path.dirname(finalPath);
                // 并发处理所有模块的导出
                const moduleExportPromises = Array.from(moduleGroups.entries()).map(async ([moduleId, moduleStories]) => {
                    const moduleIdNum = typeof moduleId === 'number' ? moduleId : parseInt(moduleId.toString()) || 0;
                    const moduleFileName = path.basename(`${basePath}_module_${moduleIdNum}.md`);
                    const moduleFilePath = path.join(baseDir, moduleFileName);
                    // 收集并下载该模块的图片
                    const moduleImageUrls = [];
                    moduleStories.forEach(story => {
                        if (story.spec) {
                            const imageUrls = zentaoApi.extractImageUrls(story.spec);
                            moduleImageUrls.push(...imageUrls);
                        }
                    });
                    let moduleSavedImages = [];
                    if (moduleImageUrls.length > 0) {
                        const uniqueImageUrls = Array.from(new Set(moduleImageUrls));
                        const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
                        const moduleDir = path.dirname(moduleFilePath);
                        moduleSavedImages = await saveImagesToDisk(downloadedImages, moduleDir, 'story', finalProductId || 0);
                        // 处理图片
                        moduleStories.forEach((story) => {
                            if (story.spec && moduleSavedImages.length > 0) {
                                const storyImageUrls = zentaoApi.extractImageUrls(story.spec);
                                const storyImages = moduleSavedImages.filter(img => storyImageUrls.includes(img.originalUrl));
                                // Markdown格式：替换URL
                                story.spec = replaceImageUrlsInContent(story.spec, storyImages);
                            }
                        });
                    }
                    const moduleResult = {
                        type: 'story',
                        mode: 'batch',
                        source: 'search',
                        productId: finalProductId || null,
                        moduleId: moduleIdNum,
                        searchConditions: {
                            keyword: keyword || null,
                            productId: finalProductId || null,
                            productName: productName || null,
                            moduleId: moduleIdNum,
                            status: status || null,
                            startDate: startDate || null,
                            endDate: endDate || null
                        },
                        items: moduleStories,
                        count: moduleStories.length,
                        images: {
                            total: moduleSavedImages.length,
                            success: moduleSavedImages.filter(img => img.success).length,
                            failed: moduleSavedImages.filter(img => !img.success).length
                        }
                    };
                    // 保存模块文件
                    const markdownContent = formatModuleItemsAsMarkdown(moduleResult);
                    fs.writeFileSync(moduleFilePath, markdownContent, 'utf-8');
                    return {
                        filePath: moduleFilePath,
                        savedImages: moduleSavedImages
                    };
                });
                // 等待所有模块导出完成
                const moduleExportResults = await Promise.allSettled(moduleExportPromises);
                moduleExportResults.forEach((result) => {
                    if (result.status === 'fulfilled') {
                        exportedFiles.push(result.value.filePath);
                        allSavedImages.push(...result.value.savedImages);
                    }
                });
                result = {
                    type: 'story',
                    mode: 'batch',
                    source: 'search',
                    productId: finalProductId || null,
                    searchConditions: {
                        keyword: keyword || null,
                        productId: finalProductId || null,
                        productName: productName || null,
                        moduleId: null, // 多个模块
                        status: status || null,
                        startDate: startDate || null,
                        endDate: endDate || null
                    },
                    items: detailedStories,
                    count: detailedStories.length,
                    modules: Array.from(moduleGroups.keys()).map(m => typeof m === 'number' ? m : parseInt(m.toString()) || 0),
                    exportedFiles: exportedFiles,
                    images: {
                        total: allSavedImages.length,
                        success: allSavedImages.filter(img => img.success).length,
                        failed: allSavedImages.filter(img => !img.success).length
                    }
                };
                // 更新 finalPath 为第一个文件路径（用于返回结果）
                finalPath = exportedFiles[0];
            }
        }
        else {
            throw createError(ErrorCode.API_ERROR, "必须指定以下参数之一：id（单个导出）、url（模块批量导出）、或搜索条件（keyword/productId/productName/moduleId/日期范围）");
        }
        const successCount = allSavedImages.filter(img => img.success).length;
        const failedCount = allSavedImages.length - successCount;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        exportedTo: finalPath,
                        format: 'markdown',
                        ...result,
                        images: {
                            total: allSavedImages.length,
                            success: successCount,
                            failed: failedCount
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `导出失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add exportStoriesBySearch tool - 根据搜索条件导出需求（支持自然语言）
server.tool("exportStoriesBySearch", {
    keyword: z.string().optional().describe("搜索关键字（可选），支持中英文，会在需求标题和描述中搜索。例如：'大R促活'、'音视频'、'每日任务'等"),
    productId: z.number().optional().describe("产品ID（可选），如果指定则只搜索该产品的需求"),
    productName: z.string().optional().describe("产品名称（可选），如果指定则按产品名称搜索"),
    status: z.enum(['draft', 'active', 'closed', 'changed', 'all']).optional().describe("需求状态（可选）：draft(草稿)、active(激活)、closed(已关闭)、changed(已变更)、all(全部)"),
    startDate: z.string().optional().describe("开始时间（可选），格式：YYYY-MM-DD 或自然语言。例如：'2024-01-01'、'今年'、'今年1月'、'最近3个月'等"),
    endDate: z.string().optional().describe("结束时间（可选），格式：YYYY-MM-DD 或自然语言。例如：'2024-12-31'、'今年'、'今年12月'、'今天'等"),
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/stories_search.md"),
    limit: z.number().optional().default(100).describe("返回结果数量限制（默认100条）")
}, async ({ keyword, productId, productName, status, startDate, endDate, exportPath, limit = 100 }) => {
    await ensureInitialized();
    try {
        let stories = [];
        // 如果指定了产品名称，先获取产品ID
        let finalProductId = productId;
        if (productName && !productId) {
            const products = await zentaoApi.getProducts();
            const matchedProduct = products.find(p => p.name.includes(productName));
            if (matchedProduct) {
                finalProductId = matchedProduct.id;
            }
            else {
                throw createError(ErrorCode.API_ERROR, `未找到产品名称包含"${productName}"的产品`);
            }
        }
        // 如果有关键字，使用搜索功能
        if (keyword) {
            // 解析自然语言时间表达式
            const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
            const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
            const searchResults = await zentaoApi.searchStories(keyword, {
                productId: finalProductId,
                status: status,
                limit,
                deepSearch: true, // 启用深度搜索以获取完整描述
                startDate: parsedStartDate || startDate,
                endDate: parsedEndDate || endDate
            });
            stories = searchResults;
        }
        else {
            // 如果没有关键字，直接获取产品需求列表
            if (finalProductId) {
                stories = await zentaoApi.getProductStories(finalProductId, status);
            }
            else {
                throw createError(ErrorCode.API_ERROR, "必须指定关键字、产品ID或产品名称中的至少一个");
            }
            // 如果指定了日期范围，进行过滤
            if (startDate || endDate) {
                const parsedStartDate = startDate ? parseNaturalDate(startDate) : undefined;
                const parsedEndDate = endDate ? parseNaturalDate(endDate) : undefined;
                stories = stories.filter(story => {
                    if (!story.openedDate)
                        return false;
                    const storyDate = story.openedDate.split(' ')[0]; // 只取日期部分
                    if (parsedStartDate && storyDate < parsedStartDate) {
                        return false;
                    }
                    if (parsedEndDate && storyDate > parsedEndDate) {
                        return false;
                    }
                    return true;
                });
            }
            // 限制数量
            stories = stories.slice(0, limit);
        }
        // 获取每个需求的详细信息（包括 spec 和图片）
        const detailedStories = await Promise.all(stories.map(async (story) => {
            try {
                const detail = await zentaoApi.getStoryDetail(story.id);
                return {
                    ...story,
                    spec: detail.spec || story.spec || ''
                };
            }
            catch (error) {
                return story;
            }
        }));
        // 使用公共函数准备导出路径
        const { finalPath, dir } = prepareExportPath(exportPath);
        // 收集所有图片 URL
        const allImageUrls = [];
        detailedStories.forEach(story => {
            if (story.spec) {
                const imageUrls = zentaoApi.extractImageUrls(story.spec);
                allImageUrls.push(...imageUrls);
            }
        });
        // 下载并保存所有图片
        let allSavedImages = [];
        if (allImageUrls.length > 0) {
            const uniqueImageUrls = Array.from(new Set(allImageUrls));
            const downloadedImages = await downloadImages(zentaoApi, uniqueImageUrls, true, 15000);
            allSavedImages = await saveImagesToDisk(downloadedImages, dir, 'story', finalProductId || 0);
            // 为每个需求添加图片信息（JSON格式）或替换URL（Markdown格式）
            detailedStories.forEach((story) => {
                if (story.spec && allSavedImages.length > 0) {
                    const storyImageUrls = zentaoApi.extractImageUrls(story.spec);
                    const storyImages = allSavedImages.filter(img => storyImageUrls.includes(img.originalUrl));
                    // Markdown格式：替换URL
                    story.spec = replaceImageUrlsInContent(story.spec, storyImages);
                }
            });
        }
        // 构建结果对象
        const result = {
            type: 'story',
            searchConditions: {
                keyword: keyword || null,
                productId: finalProductId || null,
                productName: productName || null,
                status: status || null,
                startDate: startDate || null,
                endDate: endDate || null
            },
            items: detailedStories,
            count: detailedStories.length,
            images: {
                total: allSavedImages.length,
                success: allSavedImages.filter(img => img.success).length,
                failed: allSavedImages.filter(img => !img.success).length
            }
        };
        // 导出文件（Markdown 格式）
        const markdownContent = formatModuleItemsAsMarkdown(result);
        fs.writeFileSync(finalPath, markdownContent, 'utf-8');
        const successCount = allSavedImages.filter(img => img.success).length;
        const failedCount = allSavedImages.length - successCount;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        exportedTo: finalPath,
                        format: 'markdown',
                        count: detailedStories.length,
                        images: {
                            total: allSavedImages.length,
                            success: successCount,
                            failed: failedCount
                        },
                        searchConditions: result.searchConditions
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `根据搜索条件导出需求失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add exportStory tool - 导出单个需求到文件（Markdown格式）
server.tool("exportStory", {
    storyId: z.number().describe("需求ID"),
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/story_2709.md")
}, async ({ storyId, exportPath }) => {
    await ensureInitialized();
    try {
        // 获取需求详情
        const story = await zentaoApi.getStoryDetail(storyId);
        // 使用公共函数准备导出路径
        const { finalPath, dir } = prepareExportPath(exportPath);
        // 使用公共函数处理图片
        const savedImages = await processAndSaveImages(story.spec, dir, 'story', storyId);
        // 导出文件（Markdown 格式）
        let markdownContent = formatStoryAsMarkdown(story);
        if (story.spec && savedImages.length > 0) {
            markdownContent = replaceImageUrlsInContent(markdownContent, savedImages);
        }
        fs.writeFileSync(finalPath, markdownContent, 'utf-8');
        const successCount = savedImages.filter(img => img.success).length;
        const failedCount = savedImages.length - successCount;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        storyId: storyId,
                        title: story.title,
                        exportedTo: finalPath,
                        format: 'markdown',
                        images: {
                            total: savedImages.length,
                            success: successCount,
                            failed: failedCount,
                            savedImages: savedImages.map(img => ({
                                localPath: img.localPath,
                                relativePath: img.relativePath,
                                success: img.success
                            }))
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `导出需求 ${storyId} 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
// Add exportBug tool - 导出单个Bug到文件（Markdown格式）
server.tool("exportBug", {
    bugId: z.number().describe("Bug ID"),
    exportPath: z.string().min(1, "导出文件路径不能为空").describe("导出文件路径（必填，建议使用绝对路径），例如：D:/exports/bug_123.md")
}, async ({ bugId, exportPath }) => {
    await ensureInitialized();
    try {
        // 获取Bug详情
        const bug = await zentaoApi.getBugDetail(bugId);
        // 使用公共函数准备导出路径
        const { finalPath, dir } = prepareExportPath(exportPath);
        // 使用公共函数处理图片
        const savedImages = await processAndSaveImages(bug.steps, dir, 'bug', bugId);
        // 导出文件（Markdown 格式）
        let markdownContent = formatBugAsMarkdown(bug);
        if (bug.steps && savedImages.length > 0) {
            markdownContent = replaceImageUrlsInContent(markdownContent, savedImages);
        }
        fs.writeFileSync(finalPath, markdownContent, 'utf-8');
        const successCount = savedImages.filter(img => img.success).length;
        const failedCount = savedImages.length - successCount;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        bugId: bugId,
                        title: bug.title,
                        exportedTo: finalPath,
                        format: 'markdown',
                        images: {
                            total: savedImages.length,
                            success: successCount,
                            failed: failedCount,
                            savedImages: savedImages.map(img => ({
                                localPath: img.localPath,
                                relativePath: img.relativePath,
                                success: img.success
                            }))
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        if (error instanceof ZentaoError) {
            throw error;
        }
        throw createError(ErrorCode.API_ERROR, `导出 Bug ${bugId} 失败: ${error instanceof Error ? error.message : String(error)}`, undefined, error);
    }
});
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
