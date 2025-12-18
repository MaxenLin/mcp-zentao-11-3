/**
 * 禅道旧版API (11.x版本)
 * 使用Session认证方式
 */
import { Bug, Task, Story, StoryStatus, TestCase, TestCaseStatus, TestResult, TestTask, CreateTestCaseRequest, TestRunRequest, Product, TaskUpdate, BugResolution } from './types.js';
import { ZentaoConfig } from './config.js';
export declare class ZentaoLegacyAPI {
    private config;
    private client;
    private sessionId;
    constructor(config: ZentaoConfig);
    /**
     * 获取SessionID
     */
    private getSessionId;
    /**
     * 登录
     */
    private login;
    /**
     * 确保已登录
     */
    private ensureLoggedIn;
    /**
     * 发起请求
     */
    private request;
    /**
     * POST请求
     */
    private postRequest;
    /**
     * 获取产品列表
     */
    getProducts(): Promise<Product[]>;
    /**
     * 获取产品的模块树
     * @param productId 产品ID
     * @returns 模块树对象，key是模块ID，value是模块名称
     */
    getProductModules(productId: number): Promise<Record<string, string>>;
    /**
     * 获取我的任务列表
     */
    getMyTasks(): Promise<Task[]>;
    /**
     * 获取任务详情
     */
    getTaskDetail(taskId: number): Promise<Task>;
    /**
     * 获取我的Bug列表
     */
    getMyBugs(): Promise<Bug[]>;
    /**
     * 获取Bug详情
     */
    getBugDetail(bugId: number): Promise<Bug>;
    /**
     * 更新任务
     */
    updateTask(taskId: number, update: TaskUpdate): Promise<Task>;
    /**
     * 完成任务
     */
    finishTask(taskId: number, update: TaskUpdate): Promise<void>;
    /**
     * 解决Bug
     */
    resolveBug(bugId: number, resolution: BugResolution): Promise<void>;
    /**
     * 获取产品的需求列表（支持分页，自动获取所有需求）
     */
    getProductStories(productId: number, status?: StoryStatus): Promise<Story[]>;
    /**
     * 获取需求详情
     */
    getStoryDetail(storyId: number): Promise<Story>;
    /**
     * 下载需求中的图片文件
     */
    downloadStoryImage(imageUrl: string): Promise<Buffer>;
    /**
     * 提取需求描述中的所有图片URL
     */
    extractImageUrls(spec: string): string[];
    /**
     * 提取需求描述中的文件ID
     */
    extractFileIds(spec: string): string[];
    /**
     * 搜索需求（通过关键字）
     * 由于禅道11.3的搜索API权限限制，我们通过获取所有产品的需求然后本地过滤
     *
     * 搜索范围：
     * - 如果指定 productId：搜索该产品的所有需求（全量）
     * - 如果未指定 productId：搜索所有产品的所有需求（全量）
     *
     * 优化：
     * 1. 支持分词搜索（将关键字拆分为多个词进行匹配）
     * 2. 增强匹配逻辑（标题、描述、模块名、产品名）
     * 3. 智能排序（匹配度评分：标题完全匹配 > 标题包含 > 描述匹配 > 其他字段匹配）
     * 4. 如果列表接口的spec不完整，对标题匹配的需求进行深度搜索（获取详情）
     */
    searchStories(keyword: string, options?: {
        productId?: number;
        status?: StoryStatus;
        limit?: number;
        deepSearch?: boolean;
    }): Promise<Story[]>;
    /**
     * 分词：将关键字拆分为多个词
     * 支持中英文混合，中文按字符拆分，英文按单词拆分
     */
    private splitKeywords;
    /**
     * 计算匹配度评分
     * 评分规则：
     * - 标题完全匹配：100分
     * - 标题包含关键字：80分
     * - 标题包含部分关键字（分词匹配）：60分
     * - 描述包含关键字：40分
     * - 描述包含部分关键字：20分
     * - 模块名/产品名匹配：10分
     */
    private calculateMatchScore;
    /**
     * 按产品名称搜索需求
     */
    searchStoriesByProductName(productName: string, keyword: string, options?: {
        status?: StoryStatus;
        limit?: number;
    }): Promise<{
        product: Product;
        stories: Story[];
    }[]>;
    /**
     * 获取产品的测试用例列表
     * @param productId 产品ID
     * @param status 用例状态
     * @param moduleId 模块ID（可选）
     */
    getProductTestCases(productId: number, status?: TestCaseStatus, moduleId?: number): Promise<TestCase[]>;
    /**
     * 获取测试用例详情
     */
    getTestCaseDetail(caseId: number): Promise<TestCase>;
    /**
     * 创建测试用例
     */
    createTestCase(testCase: CreateTestCaseRequest): Promise<number>;
    /**
     * 获取需求的测试用例
     */
    getStoryTestCases(storyId: number): Promise<TestCase[]>;
    /**
     * 获取测试单列表
     */
    getTestTasks(productId?: number): Promise<TestTask[]>;
    /**
     * 获取测试单详情
     */
    getTestTaskDetail(taskId: number): Promise<TestTask>;
    /**
     * 获取测试单的测试结果
     */
    getTestTaskResults(taskId: number): Promise<TestResult[]>;
    /**
     * 执行测试用例
     */
    runTestCase(taskId: number, testRun: TestRunRequest): Promise<void>;
    /**
     * 获取需求关联的 Bug 列表
     */
    getStoryRelatedBugs(storyId: number): Promise<Bug[]>;
    /**
     * 获取 Bug 关联的需求
     */
    getBugRelatedStory(bugId: number): Promise<Story | null>;
}
