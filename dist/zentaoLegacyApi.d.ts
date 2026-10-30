/**
 * 禅道旧版API (11.x版本)
 * 使用Session认证方式
 */
import { Bug, BugStatus, Task, Story, StoryStatus, TestCase, TestCaseStatus, TestResult, TestTask, CreateTestCaseRequest, TestRunRequest, Product, TaskUpdate, BugResolution, Project, CreateProjectRequest, CreateTaskRequest, CreateBugRequest, CreateStoryRequest, ChangeStoryRequest, CreateBuildRequest, Build, CreateTestTaskRequest } from './types.js';
import { ZentaoConfig } from './config.js';
export declare class ZentaoLegacyAPI {
    private config;
    private client;
    private sessionId;
    constructor(config: ZentaoConfig);
    /**
     * 禅道 11.3 的 Content-Type 是 text/html，响应体仍是 JSON。
     * axios 通常会解析，这里再兜一层，避免拿到字符串时读不到 status。
     */
    private normalizeBody;
    /**
     * 禅道 11.x 的 data 有时是 JSON 字符串，有时已经是对象。
     */
    private parsePayload;
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
     * 强制重新登录（清除sessionId后重新登录）
     */
    private forceReLogin;
    /**
     * 写操作和确认删除经常返回 HTML，而不是 JSON。
     * alert 是失败，confirm 表示还没执行，location 才是已经跳走。
     */
    /** 302 的 Location 就是成功后的去向。跳到登录页才是会话失效。 */
    private redirectOutcome;
    private htmlOutcome;
    /**
     * 发起请求（带自动重试）
     */
    private request;
    /**
     * POST请求（带自动重试）
     */
    private postRequest;
    /**
     * 禅道写操作有三种成功返回：status/data、result/locate，以及 js::locate 的 HTML。
     * 校验失败是 alert()，不能把带 script 的页面都当成掉线。
     */
    private postOutcome;
    private alertMessage;
    private today;
    private dateOnly;
    /**
     * 用例步骤在详情里是对象列表，对外保持一段文本。
     */
    private stepsText;
    /**
     * 用分页里的 pageTotal 判断还有没有下一页。
     * pageTotal 缺失时再退回 recTotal / recPerPage。
     */
    private hasNextPage;
    /**
     * 禅道模块树有时是 {id: name}，只有根模块时会变成 ["/"]。
     * 根节点不是业务模块，不返回。
     */
    private moduleMap;
    private linkedId;
    /**
     * 获取产品列表。优先用 product-all 的统计数据，里面有编号、状态和描述。
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
     * 获取产品的Bug列表（支持分页和模块过滤）
     * @param productId 产品ID
     * @param status Bug状态（可选）
     * @param moduleId 模块ID（可选），当提供时，只获取该模块下的Bug
     */
    getProductBugs(productId: number, status?: BugStatus, moduleId?: number): Promise<Bug[]>;
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
     * @param productId 产品ID
     * @param status 需求状态（可选）
     * @param moduleId 模块ID（可选），当提供时，只获取该模块下的需求
     */
    getProductStories(productId: number, status?: StoryStatus, moduleId?: number): Promise<Story[]>;
    /**
     * 获取指派给我的需求。列表接口不带描述。
     */
    getMyStories(): Promise<Story[]>;
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
     * 5. 支持时间范围过滤（按创建时间 openedDate）
     */
    searchStories(keyword: string, options?: {
        productId?: number;
        status?: StoryStatus;
        limit?: number;
        deepSearch?: boolean;
        startDate?: string;
        endDate?: string;
    }): Promise<Story[]>;
    /**
     * 分词：英文按单词，中文按二字词。
     */
    private splitKeywords;
    /**
     * 列表里的需求没有描述。只给缺少 spec 的条目补详情。
     */
    private attachSpecs;
    /**
     * 按时间范围过滤需求
     * @param stories 需求列表
     * @param startDate 开始时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @param endDate 结束时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @returns 过滤后的需求列表
     */
    private filterByDateRange;
    /**
     * 解析日期字符串
     * 支持格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
     */
    private parseDate;
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
    private locateId;
    private daySpan;
    /** 项目任务、版本列表有时是对象，有时按需求再套一层数组。 */
    private collectRecords;
    private mapTask;
    private mapProject;
    private projectPairs;
    getProjects(): Promise<Project[]>;
    getProject(projectId: number): Promise<Project>;
    createProject(input: CreateProjectRequest): Promise<Project>;
    deleteProject(projectId: number): Promise<void>;
    getProjectTasks(projectId: number): Promise<Task[]>;
    createTask(input: CreateTaskRequest): Promise<Task>;
    startTask(taskId: number, options?: {
        consumed?: number;
        left?: number;
    }): Promise<Task>;
    closeTask(taskId: number, comment?: string): Promise<Task>;
    assignTask(taskId: number, assignedTo: string, options?: {
        left?: number;
        comment?: string;
    }): Promise<Task>;
    deleteTask(taskId: number): Promise<void>;
    createBug(input: CreateBugRequest): Promise<Bug>;
    closeBug(bugId: number, comment?: string): Promise<Bug>;
    activateBug(bugId: number, options?: {
        assignedTo?: string;
        comment?: string;
    }): Promise<Bug>;
    assignBug(bugId: number, assignedTo: string, comment?: string): Promise<Bug>;
    deleteBug(bugId: number): Promise<void>;
    createStory(input: CreateStoryRequest): Promise<Story>;
    changeStory(storyId: number, input: ChangeStoryRequest): Promise<Story>;
    closeStory(storyId: number, closedReason: string, comment?: string): Promise<Story>;
    activateStory(storyId: number, options?: {
        assignedTo?: string;
        comment?: string;
    }): Promise<Story>;
    deleteStory(storyId: number): Promise<void>;
    getProjectBuilds(projectId: number): Promise<Build[]>;
    createBuild(input: CreateBuildRequest): Promise<Build>;
    deleteBuild(buildId: number): Promise<void>;
    createTestTask(input: CreateTestTaskRequest): Promise<TestTask>;
    linkTestCase(taskId: number, caseId: number, version?: number): Promise<void>;
    deleteTestTask(taskId: number): Promise<void>;
    deleteTestCase(caseId: number): Promise<void>;
}
