/**
 * 禅道旧版API (11.x版本)
 * 使用Session认证方式
 */

import http from 'node:http';
import https from 'node:https';
import axios, { AxiosInstance } from 'axios';
import { Bug, BugStatus, Task, TaskStatus, Story, StoryStatus, TestCase, TestCaseStatus, TestResult, TestTask, CreateTestCaseRequest, TestRunRequest, Product, TaskUpdate, BugResolution, Project, CreateProjectRequest, CreateTaskRequest, CreateBugRequest, CreateStoryRequest, ChangeStoryRequest, CreateBuildRequest, Build, CreateTestTaskRequest } from './types.js';
import { ZentaoConfig } from './config.js';

export class ZentaoLegacyAPI {
    private config: ZentaoConfig;
    private client: AxiosInstance;
    private sessionId: string | null = null;

    constructor(config: ZentaoConfig) {
        this.config = config;
        // 禅道11.x使用的是传统的URL格式，不是RESTful API
        this.client = axios.create({
            baseURL: this.config.url,
            timeout: 10000,
            // 长连接闲置后会被 Apache 丢掉，下一次写操作变成 ECONNRESET，服务端甚至没有访问日志。
            httpAgent: new http.Agent({ keepAlive: false }),
            httpsAgent: new https.Agent({ keepAlive: false }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Connection: 'close',
            },
            // $this->locate() 是 302。跟着跳会丢掉 zentaosid，下一页就变成登录页。
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });
    }

    /**
     * 禅道 11.3 的 Content-Type 是 text/html，响应体仍是 JSON。
     * axios 通常会解析，这里再兜一层，避免拿到字符串时读不到 status。
     */
    private normalizeBody(payload: unknown): any {
        if (typeof payload !== 'string') {
            return payload;
        }
        const trimmed = payload.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return payload;
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            return payload;
        }
    }

    /**
     * 禅道 11.x 的 data 有时是 JSON 字符串，有时已经是对象。
     */
    private parsePayload(data: unknown): any {
        if (data == null || data === '') {
            return {};
        }
        if (typeof data === 'object') {
            return data;
        }
        if (typeof data === 'string') {
            return JSON.parse(data);
        }
        throw new Error(`无法解析禅道响应: ${String(data).slice(0, 200)}`);
    }

    /**
     * 获取SessionID
     */
    private async getSessionId(): Promise<string> {
        if (this.sessionId) return this.sessionId;

        try {
            const response = await this.client.get('/api-getSessionID.json');
            const body = this.normalizeBody(response.data);

            if (body.status === 'success') {
                const data = this.parsePayload(body.data);
                if (!data?.sessionID) {
                    throw new Error(`获取SessionID失败: ${JSON.stringify(body)}`);
                }
                this.sessionId = data.sessionID;
                return this.sessionId as string;
            }

            throw new Error(`获取SessionID失败: ${JSON.stringify(body)}`);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response
                    ? `状态码: ${error.response.status}, 响应: ${JSON.stringify(error.response.data)}`
                    : error.message;
                throw new Error(`获取SessionID失败: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * 登录
     */
    private async login(): Promise<void> {
        const sid = await this.getSessionId();

        try {
            const params = new URLSearchParams();
            params.append('account', this.config.username);
            params.append('password', this.config.password);
            params.append('keepLogin[]', 'on');
            params.append('referer', `${this.config.url}/my/`);

            const response = await this.client.post(
                `/user-login.json?zentaosid=${sid}`,
                params
            );

            if (response.data.status === 'success') {
                return;
            }

            throw new Error(`登录失败: ${JSON.stringify(response.data)}`);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const errorMessage = error.response
                    ? `状态码: ${error.response.status}, 响应: ${JSON.stringify(error.response.data)}`
                    : error.message;
                throw new Error(`登录失败: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * 确保已登录
     */
    private async ensureLoggedIn(): Promise<string> {
        if (!this.sessionId) {
            await this.login();
        }
        return this.sessionId as string;
    }

    /**
     * 强制重新登录（清除sessionId后重新登录）
     */
    private async forceReLogin(): Promise<string> {
        this.sessionId = null;
        await this.login();
        if (!this.sessionId) {
            throw new Error('重新登录失败：未能获取sessionId');
        }
        return this.sessionId;
    }

    /**
     * 写操作和确认删除经常返回 HTML，而不是 JSON。
     * alert 是失败，confirm 表示还没执行，location 才是已经跳走。
     */
    /** 302 的 Location 就是成功后的去向。跳到登录页才是会话失效。 */
    private redirectOutcome(status: number, location: unknown): { ok: boolean; expired: boolean; data: any; message: string } | null {
        if (status < 300 || status >= 400) {
            return null;
        }
        const locate = String(location || '');
        if (locate.includes('user-login')) {
            return { ok: false, expired: true, data: { locate }, message: '会话已过期' };
        }
        return { ok: true, expired: false, data: { locate }, message: '' };
    }

    private htmlOutcome(body: string): { ok: boolean; expired: boolean; data: any; message: string } | null {
        if (body.includes('user-login')) {
            return { ok: false, expired: true, data: body, message: '会话已过期' };
        }
        const alertText = this.alertMessage(body);
        if (alertText) {
            return { ok: false, expired: false, data: body, message: alertText };
        }
        if (/confirm\s*\(/.test(body)) {
            const matched = body.match(/confirm\(\s*"([^"]*)"/) || body.match(/confirm\(\s*'((?:\\'|[^'])*)'/);
            const message = (matched?.[1] || '操作需要确认').replace(/\\'/g, "'").replace(/\\n/g, '\n');
            return { ok: false, expired: false, data: body, message };
        }
        if (/\.location\s*=/.test(body)) {
            const locate = body.match(/\.location\s*=\s*'([^']*)'/);
            return { ok: true, expired: false, data: { locate: locate?.[1] ?? '' }, message: '' };
        }
        return null;
    }

    /**
     * 发起请求（带自动重试）
     */
    private async request<T>(url: string, params?: any, retried: boolean = false): Promise<T> {
        const sid = await this.ensureLoggedIn();
        
        try {
            const fullUrl = `${url}?zentaosid=${sid}`;
            
            const response = await this.client.get(fullUrl, { params });
            const redirected = this.redirectOutcome(response.status, response.headers?.location);
            if (redirected) {
                if (redirected.expired) {
                    if (!retried) {
                        console.error('检测到会话过期，正在重新登录...');
                        await this.forceReLogin();
                        return this.request<T>(url, params, true);
                    }
                    throw new Error('会话已过期，重新登录后仍然失败');
                }
                return redirected.data as T;
            }
            const body = this.normalizeBody(response.data);

            if (typeof body === 'string') {
                const outcome = this.htmlOutcome(body);
                if (outcome?.expired) {
                    if (!retried) {
                        console.error('检测到会话过期，正在重新登录...');
                        await this.forceReLogin();
                        return this.request<T>(url, params, true);
                    }
                    throw new Error('会话已过期，重新登录后仍然失败');
                }
                if (outcome?.ok) {
                    return outcome.data as T;
                }
                throw new Error(outcome?.message || `请求失败: ${body.slice(0, 300)}`);
            }

            if (body.status === 'success') {
                return this.parsePayload(body.data);
            }

            throw new Error(`请求失败: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('请求失败:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                throw new Error(`请求失败: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * POST请求（带自动重试）
     */
    private async postRequest<T>(url: string, data?: any, retried: boolean = false): Promise<T> {
        const sid = await this.ensureLoggedIn();
        
        try {
            const fullUrl = `${url}?zentaosid=${sid}`;
            
            const params = new URLSearchParams();
            if (data) {
                Object.keys(data).forEach(key => {
                    const value = data[key];
                    // undefined 会被拼成字符串 "undefined" 提交给禅道
                    if (value === undefined || value === null) {
                        return;
                    }
                    if (Array.isArray(value)) {
                        value.forEach(item => {
                            if (item !== undefined && item !== null) {
                                params.append(key, String(item));
                            }
                        });
                        return;
                    }
                    params.append(key, String(value));
                });
            }

            const response = await this.client.post(fullUrl, params);
            const redirected = this.redirectOutcome(response.status, response.headers?.location);
            if (redirected) {
                if (redirected.expired) {
                    if (!retried) {
                        console.error('检测到会话过期，正在重新登录...');
                        await this.forceReLogin();
                        return this.postRequest<T>(url, data, true);
                    }
                    throw new Error('会话已过期，重新登录后仍然失败');
                }
                return redirected.data as T;
            }
            const body = this.normalizeBody(response.data);
            const outcome = this.postOutcome(body);

            if (outcome.expired) {
                if (!retried) {
                    console.error('检测到会话过期，正在重新登录...');
                    await this.forceReLogin();
                    return this.postRequest<T>(url, data, true);
                }
                throw new Error('会话已过期，重新登录后仍然失败');
            }

            if (outcome.ok) {
                return outcome.data as T;
            }

            throw new Error(outcome.message);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('请求失败:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                throw new Error(`请求失败: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * 禅道写操作有三种成功返回：status/data、result/locate，以及 js::locate 的 HTML。
     * 校验失败是 alert()，不能把带 script 的页面都当成掉线。
     */
    private postOutcome(body: any): { ok: boolean; expired: boolean; data: any; message: string } {
        if (typeof body === 'string') {
            return this.htmlOutcome(body) ?? {
                ok: false,
                expired: false,
                data: body,
                message: `请求失败: ${body.slice(0, 300)}`,
            };
        }

        if (body && typeof body === 'object') {
            if (body.status === 'success' || body.result === 'success') {
                const data = body.data != null && body.data !== '' ? this.parsePayload(body.data) : body;
                return { ok: true, expired: false, data, message: '' };
            }
            if (body.status === 'fail' || body.result === 'fail') {
                const message = typeof body.message === 'string'
                    ? body.message
                    : JSON.stringify(body.message ?? body);
                return { ok: false, expired: false, data: body, message };
            }
        }

        return {
            ok: false,
            expired: false,
            data: body,
            message: `请求失败: ${JSON.stringify(body).slice(0, 300)}`,
        };
    }

    private alertMessage(body: unknown): string | null {
        if (typeof body !== 'string') {
            return null;
        }
        const alertMatch = body.match(/alert\('((?:\\'|[^'])*)'\)/);
        if (!alertMatch) {
            return null;
        }
        const message = alertMatch[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").trim();
        return message || '请求失败';
    }

    private today(): string {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    private dateOnly(value: unknown): string {
        const text = String(value ?? '');
        if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
            return text.slice(0, 10);
        }
        return '0000-00-00';
    }

    /**
     * 用例步骤在详情里是对象列表，对外保持一段文本。
     */
    private stepsText(steps: unknown): string {
        if (!steps) {
            return '';
        }
        if (typeof steps === 'string') {
            return steps;
        }
        const list = Array.isArray(steps) ? steps : (typeof steps === 'object' ? Object.values(steps as object) : []);
        if (list.length === 0) {
            return '';
        }
        return list.map((step: any, index: number) => {
            const desc = String(step?.desc || step?.name || '').trim();
            const expect = String(step?.expect || '').trim();
            if (!desc && !expect) {
                return '';
            }
            return `${index + 1}. ${desc}${expect ? ` => ${expect}` : ''}`;
        }).filter(Boolean).join('\n');
    }

    /**
     * 用分页里的 pageTotal 判断还有没有下一页。
     * pageTotal 缺失时再退回 recTotal / recPerPage。
     */
    private hasNextPage(pager: any, currentPage: number, batchSize: number): boolean {
        if (!pager || batchSize <= 0) {
            return false;
        }
        if (pager.pageTotal !== undefined && pager.pageTotal !== null && pager.pageTotal !== '') {
            const pageTotal = Number(pager.pageTotal);
            if (Number.isFinite(pageTotal)) {
                return currentPage < pageTotal;
            }
        }
        const recPerPage = Number(pager.recPerPage);
        const recTotal = Number(pager.recTotal);
        if (!Number.isFinite(recPerPage) || recPerPage <= 0) {
            return false;
        }
        return currentPage < Math.ceil(recTotal / recPerPage);
    }

    /**
     * 禅道模块树有时是 {id: name}，只有根模块时会变成 ["/"]。
     * 根节点不是业务模块，不返回。
     */
    private moduleMap(modules: unknown): Record<string, string> {
        if (!modules || typeof modules !== 'object') {
            return {};
        }
        const entries = Array.isArray(modules)
            ? modules.map((name, index) => [String(index), name] as const)
            : Object.entries(modules as Record<string, unknown>);
        const map: Record<string, string> = {};
        for (const [id, name] of entries) {
            if (name === undefined || name === null || name === '' || id === '0' || name === '/') {
                continue;
            }
            map[id] = String(name);
        }
        return map;
    }

    private linkedId(value: unknown): number {
        if (value === undefined || value === null || value === '') {
            return 0;
        }
        const id = parseInt(String(value), 10);
        return Number.isFinite(id) && id > 0 ? id : 0;
    }

    /**
     * 获取产品列表。优先用 product-all 的统计数据，里面有编号、状态和描述。
     */
    async getProducts(): Promise<Product[]> {
        try {
            const data = await this.request<any>('/product-all.json');
            const stats = data.productStats;
            const list = Array.isArray(stats)
                ? stats
                : (stats && typeof stats === 'object' ? Object.values(stats) : []);
            if (list.length > 0) {
                return list.map((product: any) => ({
                    id: parseInt(product.id),
                    name: product.name,
                    code: product.code || '',
                    status: product.status || '',
                    desc: product.desc || ''
                }));
            }
        } catch (error) {
            console.error('获取产品统计失败，改用产品索引:', error);
        }

        const data = await this.request<any>('/product-index-no.json');
        const products = data.products || {};
        return Object.keys(products).map(id => ({
            id: parseInt(id),
            name: products[id],
            code: '',
            status: '',
            desc: ''
        }));
    }

    /**
     * 获取产品的模块树
     * @param productId 产品ID
     * @returns 模块树对象，key是模块ID，value是模块名称
     */
    async getProductModules(productId: number): Promise<Record<string, string>> {
        try {
            // 尝试多个可能的API路径
            const paths = [
                `/tree-browse-${productId}-story.json`,
                `/product-browse-${productId}.json`,
                `/story-create-${productId}.json`,
            ];

            for (const apiPath of paths) {
                try {
                    const data = await this.request<any>(apiPath);
                    const modules = this.moduleMap(data.modules || data.productModules || data.moduleTree || {});
                    if (Object.keys(modules).length > 0) {
                        return modules;
                    }
                } catch (err) {
                    continue;
                }
            }

            return {};
        } catch (error) {
            console.error(`获取产品${productId}的模块树失败:`, error);
            return {};
        }
    }

    /**
     * 获取我的任务列表
     */
    async getMyTasks(): Promise<Task[]> {
        const data = await this.request<any>('/my-task.json');
        const tasks = data.tasks || {};

        return Object.values(tasks).map((task: any) => ({
            id: parseInt(task.id),
            name: task.name,
            status: task.status as TaskStatus,
            pri: parseInt(task.pri),
            deadline: task.deadline,
            desc: task.desc || '',
        }));
    }

    /**
     * 获取任务详情
     */
    async getTaskDetail(taskId: number): Promise<Task> {
        const data = await this.request<any>(`/task-view-${taskId}.json`);
        return this.mapTask(data.task);
    }

    /**
     * 获取我的Bug列表
     */
    async getMyBugs(): Promise<Bug[]> {
        const data = await this.request<any>('/my-bug.json');
        const bugs = data.bugs || {};

        return Object.values(bugs).map((bug: any) => ({
            id: parseInt(bug.id),
            title: bug.title,
            status: bug.status as BugStatus,
            severity: parseInt(bug.severity),
            steps: bug.steps || '',
            openedDate: bug.openedDate,
        }));
    }

    /**
     * 获取产品的Bug列表（支持分页和模块过滤）
     * @param productId 产品ID
     * @param status Bug状态（可选）
     * @param moduleId 模块ID（可选），当提供时，只获取该模块下的Bug
     */
    async getProductBugs(productId: number, status?: BugStatus, moduleId?: number): Promise<Bug[]> {
        try {
            // 禅道11.x API路径：/bug-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
            // 当 browseType = 'byModule' 时，param 是模块ID
            // 当 browseType 是状态时，param 是 0

            let browseType: string;
            let param: number | string = 0;

            if (moduleId) {
                // 按模块浏览
                browseType = 'byModule';
                param = moduleId;
            } else if (status && status !== 'all') {
                // 按状态浏览
                browseType = status;
                param = 0;
            } else {
                // 浏览全部
                browseType = 'all';
                param = 0;
            }

            const allBugs: any[] = [];
            const seenBugIds = new Set<number>();
            let currentPage = 1;
            const pageSize = 100;
            let hasMore = true;

            while (hasMore) {
                const url = `/bug-browse-${productId}-0-${browseType}-${param}-id_desc-0-${pageSize}-${currentPage}.json`;
                const data = await this.request<any>(url);
                const bugs = data.bugs || {};
                const bugsArray = Object.values(bugs);

                for (const rawBug of bugsArray) {
                    const bugId = parseInt((rawBug as any).id);
                    if (!Number.isNaN(bugId) && seenBugIds.has(bugId)) {
                        continue;
                    }
                    if (!Number.isNaN(bugId)) {
                        seenBugIds.add(bugId);
                    }
                    allBugs.push(rawBug);
                }

                hasMore = this.hasNextPage(data.pager, currentPage, bugsArray.length);

                currentPage++;

                // 安全限制：最多获取100页
                if (currentPage > 100) {
                    break;
                }
            }

            let mappedBugs = allBugs.map((bug: any) => ({
                id: parseInt(bug.id),
                title: bug.title,
                status: bug.status as BugStatus,
                severity: parseInt(bug.severity),
                steps: bug.steps || '',
                openedDate: bug.openedDate,
                story: this.linkedId(bug.story) || undefined,
                product: bug.product ? parseInt(bug.product) : undefined,
                module: bug.module ? parseInt(bug.module) : undefined,
            }));

            // 如果同时指定了 moduleId 和 status，需要在本地进行状态过滤
            // 因为禅道API的 browseType 只能是一个值（要么 byModule，要么状态）
            if (moduleId && status && status !== 'all') {
                mappedBugs = mappedBugs.filter(bug => bug.status === status);
            }

            return mappedBugs;
        } catch (error) {
            console.error('获取产品Bug列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取Bug详情
     */
    async getBugDetail(bugId: number): Promise<Bug> {
        const data = await this.request<any>(`/bug-view-${bugId}.json`);
        const bug = data.bug;
        const product = data.product;
        let productName = product?.name as string | undefined;
        // 11.3 的 bug-view 不带产品对象，名称要从产品列表补。
        if (!productName && this.linkedId(bug.product)) {
            const products = await this.getProducts();
            productName = products.find(item => item.id === parseInt(bug.product))?.name;
        }

        return {
            id: parseInt(bug.id),
            title: bug.title,
            status: bug.status as BugStatus,
            severity: parseInt(bug.severity),
            steps: bug.steps || '',
            openedDate: bug.openedDate,
            story: this.linkedId(bug.story) || undefined,
            product: bug.product || undefined,
            productName,
            assignedTo: bug.assignedTo || undefined,
        };
    }

    /**
     * 更新任务
     */
    async updateTask(taskId: number, update: TaskUpdate): Promise<Task> {
        const data = await this.request<any>(`/task-view-${taskId}.json`);
        const current = data.task;
        // 编辑接口会按提交的整张表单覆盖。只传工时会把名称、类型清空，消耗还会被默认成 0。
        const consumed = update.consumed ?? Number(current.consumed || 0);
        const left = update.left ?? Number(current.left || 0);
        await this.postRequest(`/task-edit-${taskId}.json`, {
            name: current.name,
            type: current.type || 'devel',
            pri: current.pri || 3,
            estimate: current.estimate || 0,
            consumed,
            left,
            status: update.status || current.status,
            assignedTo: current.assignedTo || '',
            estStarted: this.dateOnly(current.estStarted),
            deadline: this.dateOnly(current.deadline),
            desc: current.desc || '',
            story: this.linkedId(current.story) || 0,
            comment: update.comment || '',
        });

        return await this.getTaskDetail(taskId);
    }

    /**
     * 完成任务
     */
    async finishTask(taskId: number, update: TaskUpdate): Promise<void> {
        await this.postRequest(`/task-finish-${taskId}.json`, {
            consumed: update.consumed || 0,
            finishedDate: update.finishedDate || this.today(),
            comment: update.comment || '',
        });
    }

    /**
     * 解决Bug
     */
    async resolveBug(bugId: number, resolution: BugResolution): Promise<void> {
        await this.postRequest(`/bug-resolve-${bugId}.json`, {
            resolution: resolution.resolution,
            resolvedBuild: resolution.resolvedBuild || 'trunk',
            duplicateBug: resolution.duplicateBug,
            comment: resolution.comment || '',
        });
    }

    /**
     * 获取产品的需求列表（支持分页，自动获取所有需求）
     * @param productId 产品ID
     * @param status 需求状态（可选）
     * @param moduleId 模块ID（可选），当提供时，只获取该模块下的需求
     */
    async getProductStories(productId: number, status?: StoryStatus, moduleId?: number): Promise<Story[]> {

        // 禅道11.x API分页支持：
        // URL格式：/product-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
        // 参数说明：
        // - productId: 产品ID
        // - branch: 分支（默认0）
        // - browseType: unclosed(未关闭) | all(全部) | active(激活) | draft(草稿) | closed(已关闭) | changed(已变更) | byModule(按模块)
        // - param: 模块ID或查询ID（默认0），当browseType=byModule时，param是模块ID
        // - orderBy: 排序字段（默认id_desc）
        // - recTotal: 总记录数（可以为0，系统会自动计算）
        // - recPerPage: 每页记录数（默认20，可以设置更大值如100、500）
        // - pageID: 页码（从1开始）

        const allStories: any[] = [];
        let currentPage = 1;
        const pageSize = 100; // 每页获取100条
        let hasMore = true;
        const seenStoryIds = new Set<number>();

        // 映射status参数到browseType
        // 禅道11.3产品需求页实际使用的是 *story 后缀的 browseType：
        // allstory / activestory / draftstory / changedstory / closedstory。
        // 不带 story 后缀的 all/active/draft/changed/closed 在部分 11.3 环境会返回 0 条。
        let browseType: string;
        let param: number | string = 0;
        const requestedStatus = status || 'active';

        if (moduleId) {
            // 按模块浏览时 browseType 只能是 byModule，状态需要在本地过滤。
            browseType = 'byModule';
            param = moduleId;
        } else {
            switch (requestedStatus) {
                case 'all':
                    browseType = 'allstory';
                    break;
                case 'active':
                    browseType = 'activestory';
                    break;
                case 'draft':
                    browseType = 'draftstory';
                    break;
                case 'closed':
                    browseType = 'closedstory';
                    break;
                case 'changed':
                    browseType = 'changedstory';
                    break;
                default:
                    browseType = 'unclosed';
            }
        }

        const fetchBrowseType = async (type: string, typeParam: number | string = param): Promise<void> => {
            currentPage = 1;
            hasMore = true;

            while (hasMore) {
                // 构建URL：/product-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
                const url = `/product-browse-${productId}-0-${type}-${typeParam}-id_desc-0-${pageSize}-${currentPage}.json`;

                const data = await this.request<any>(url);
                const stories = data.stories || {};
                const storiesArray = Object.values(stories);

                // 添加到结果数组并按需求ID去重，避免 all 回退合并时重复
                for (const rawStory of storiesArray) {
                    const storyId = parseInt((rawStory as any).id);
                    if (!Number.isNaN(storyId) && !seenStoryIds.has(storyId)) {
                        seenStoryIds.add(storyId);
                        allStories.push(rawStory);
                    }
                }

                hasMore = this.hasNextPage(data.pager, currentPage, storiesArray.length);

                currentPage++;

                // 安全限制：最多获取100页，避免无限循环
                if (currentPage > 100) {
                    break;
                }
            }
        };

        if (!moduleId && requestedStatus === 'all') {
            await fetchBrowseType('allstory', 0);
        } else {
            await fetchBrowseType(browseType, param);
        }

        // 映射为标准格式
        let mappedStories = allStories.map((story: any) => ({
            id: parseInt(story.id),
            title: story.title,
            status: story.status as string,
            pri: parseInt(story.pri),
            stage: story.stage,
            estimate: story.estimate ? parseFloat(story.estimate) : undefined,
            openedBy: story.openedBy,
            openedDate: story.openedDate,
            assignedTo: story.assignedTo,
            spec: story.spec || '',
            module: story.module,
            product: story.product,
            closedBy: story.closedBy,
            closedDate: story.closedDate,
            closedReason: story.closedReason,
        }));

        // 如果同时指定了 moduleId 和 status，需要在本地进行状态过滤
        // 因为禅道API的 browseType 只能是一个值（要么 byModule，要么状态）
        if (moduleId && status && status !== 'all') {
            mappedStories = mappedStories.filter(story => story.status === status);
        }

        return mappedStories;
    }

    /**
     * 获取指派给我的需求。列表接口不带描述。
     */
    async getMyStories(): Promise<Story[]> {
        const data = await this.request<any>('/my-story.json');
        return Object.values(data.stories || {}).map((story: any) => ({
            id: parseInt(story.id),
            title: story.title,
            status: story.status as string,
            pri: parseInt(story.pri),
            stage: story.stage,
            estimate: story.estimate ? parseFloat(story.estimate) : undefined,
            openedBy: story.openedBy,
            openedDate: story.openedDate,
            assignedTo: story.assignedTo,
            spec: story.spec || '',
            module: story.module,
            product: story.product,
            productName: story.productTitle || story.productName,
            closedBy: story.closedBy,
            closedDate: story.closedDate,
            closedReason: story.closedReason,
        }));
    }

    /**
     * 获取需求详情
     */
    async getStoryDetail(storyId: number): Promise<Story> {
        const data = await this.request<any>(`/story-view-${storyId}.json`);
        const story = data.story;
        const product = data.product;

        // 获取模块名称
        let moduleName: string | undefined;

        // 如果有模块ID，从模块树API获取模块名称
        if (story.module && story.module !== '0' && story.product) {
            try {
                const modules = await this.getProductModules(parseInt(story.product));
                moduleName = modules[story.module];
            } catch (error) {
                console.error('获取模块名称失败:', error);
            }
        }

        return {
            id: parseInt(story.id),
            title: story.title,
            status: story.status as string,
            pri: parseInt(story.pri),
            stage: story.stage,
            estimate: story.estimate ? parseFloat(story.estimate) : undefined,
            openedBy: story.openedBy,
            openedDate: story.openedDate,
            assignedTo: story.assignedTo,
            spec: story.spec || '',
            module: story.module,
            moduleName: moduleName,
            product: story.product,
            productName: product?.name,
            closedBy: story.closedBy,
            closedDate: story.closedDate,
            closedReason: story.closedReason,
        };
    }

    /**
     * 下载需求中的图片文件
     */
    async downloadStoryImage(imageUrl: string): Promise<Buffer> {
        const sid = await this.ensureLoggedIn();

        // 构建完整的图片URL
        let fullImageUrl: string;
        if (imageUrl.startsWith('/zentao/')) {
            // 移除重复的 /zentao 前缀
            const cleanUrl = imageUrl.replace('/zentao/', '/');
            fullImageUrl = `${this.config.url}${cleanUrl}`;
        } else if (imageUrl.startsWith('/')) {
            fullImageUrl = `${this.config.url}${imageUrl}`;
        } else {
            fullImageUrl = imageUrl;
        }

        const response = await this.client.get(fullImageUrl, {
            params: { zentaosid: sid },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        return Buffer.from(response.data);
    }

    /**
     * 提取需求描述中的所有图片URL
     */
    extractImageUrls(spec: string): string[] {
        const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
        const images: string[] = [];
        let match;

        while ((match = imgRegex.exec(spec)) !== null) {
            images.push(match[1]);
        }

        return images;
    }

    /**
     * 提取需求描述中的文件ID
     */
    extractFileIds(spec: string): string[] {
        const fileRegex = /file-read-(\d+)/g;
        const fileIds: string[] = [];
        let match;

        while ((match = fileRegex.exec(spec)) !== null) {
            fileIds.push(match[1]);
        }

        return fileIds;
    }

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
    async searchStories(keyword: string, options?: {
        productId?: number;
        status?: StoryStatus;
        limit?: number;
        deepSearch?: boolean; // 是否深度搜索（获取详情以获取完整描述）
        startDate?: string; // 开始时间（格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
        endDate?: string; // 结束时间（格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
    }): Promise<Story[]> {
        const { productId, status, limit = 50, deepSearch = false, startDate, endDate } = options || {};

        try {
            let allStories: Story[] = [];

            if (productId) {
                // 搜索指定产品的需求
                allStories = await this.getProductStories(productId, status);
            } else {
                // 搜索所有产品的需求（全量搜索）
                const products = await this.getProducts();

                // 全量搜索：遍历所有产品
                for (const product of products) {
                    try {
                        const stories = await this.getProductStories(product.id, status);
                        allStories.push(...stories);
                    } catch (error) {
                        // 某个产品获取失败，继续处理其他产品
                        console.warn(`获取产品 ${product.id} (${product.name}) 的需求失败:`, error);
                        continue;
                    }
                }
            }

            // 时间范围过滤（如果指定了时间范围，先过滤再搜索，提高性能）
            if (startDate || endDate) {
                allStories = this.filterByDateRange(allStories, startDate, endDate);
            }

            // 列表接口没有 spec。数量不多时补详情，否则描述里的关键字搜不到。
            const specCap = allStories.length <= 20 || deepSearch
                ? Math.min(allStories.length, deepSearch ? 30 : 20)
                : 0;
            if (specCap > 0) {
                allStories = await this.attachSpecs(allStories, specCap);
            }

            // 分词：中文按二字词，不再把每个字都当成命中。
            const keywords = this.splitKeywords(keyword);
            const keyword_lower = keyword.toLowerCase();

            // 计算匹配度评分
            const scoredStories = allStories.map(story => {
                const score = this.calculateMatchScore(story, keyword_lower, keywords);
                return { story, score };
            }).filter(item => item.score > 0); // 只保留有匹配的

            // 按评分降序排序
            scoredStories.sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                // 评分相同，按ID倒序（新的在前）
                return b.story.id - a.story.id;
            });

            // 限制返回数量
            return scoredStories.slice(0, limit).map(item => item.story);

        } catch (error) {
            console.error('搜索需求失败:', error);
            throw new Error(`搜索需求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 分词：英文按单词，中文按二字词。
     */
    private splitKeywords(keyword: string): string[] {
        const keywords: string[] = [];
        const lowerKeyword = keyword.toLowerCase();

        const englishWords = lowerKeyword.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
        keywords.push(...englishWords.filter(word => word.length >= 2 || lowerKeyword.length === 1));

        // 两个字及以上的中文用二字词。单字关键字仍按这个字匹配。
        const runs = lowerKeyword.match(/[\u4e00-\u9fa5]+/g) || [];
        for (const run of runs) {
            if (run.length === 1) {
                keywords.push(run);
                continue;
            }
            for (let i = 0; i < run.length - 1; i++) {
                keywords.push(run.slice(i, i + 2));
            }
        }

        if (keywords.length === 0) {
            keywords.push(lowerKeyword);
        }

        return keywords;
    }

    /**
     * 列表里的需求没有描述。只给缺少 spec 的条目补详情。
     */
    private async attachSpecs(stories: Story[], cap: number): Promise<Story[]> {
        const missing = stories.filter(story => !story.spec).slice(0, cap);
        if (missing.length === 0) {
            return stories;
        }

        const details = new Map<number, Story>();
        const batchSize = 5;
        for (let i = 0; i < missing.length; i += batchSize) {
            const batch = missing.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(story => this.getStoryDetail(story.id)));
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    details.set(batch[index].id, result.value);
                }
            });
        }

        return stories.map(story => details.get(story.id) ?? story);
    }

    /**
     * 按时间范围过滤需求
     * @param stories 需求列表
     * @param startDate 开始时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @param endDate 结束时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @returns 过滤后的需求列表
     */
    private filterByDateRange(stories: Story[], startDate?: string, endDate?: string): Story[] {
        if (!startDate && !endDate) {
            return stories;
        }

        const start = startDate ? this.parseDate(startDate) : null;
        const end = endDate ? this.parseDate(endDate) : null;

        return stories.filter(story => {
            if (!story.openedDate) {
                return false; // 没有创建时间的需求不包含在时间范围内
            }

            const storyDate = this.parseDate(story.openedDate);
            if (!storyDate) {
                return false;
            }

            // 检查是否在时间范围内
            if (start && storyDate < start) {
                return false;
            }
            if (end && storyDate > end) {
                return false;
            }

            return true;
        });
    }

    /**
     * 解析日期字符串
     * 支持格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
     */
    private parseDate(dateStr: string): Date | null {
        if (!dateStr) {
            return null;
        }

        // 尝试解析常见格式
        // 格式1: YYYY-MM-DD
        // 格式2: YYYY-MM-DD HH:mm:ss
        // 格式3: YYYY-MM-DDTHH:mm:ss (ISO格式)
        const date = new Date(dateStr);
        
        if (isNaN(date.getTime())) {
            return null;
        }

        return date;
    }

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
    private calculateMatchScore(story: Story, keyword: string, keywords: string[]): number {
        let score = 0;
        const title_lower = story.title.toLowerCase();
        const spec_lower = (story.spec || '').toLowerCase();
        const moduleName_lower = (story.moduleName || '').toLowerCase();
        const productName_lower = (story.productName || '').toLowerCase();

        // 标题完全匹配（最高优先级）
        if (title_lower === keyword) {
            score += 100;
        }
        // 标题包含完整关键字
        else if (title_lower.includes(keyword)) {
            score += 80;
        }
        // 标题包含部分关键字（分词匹配）
        else {
            const titleKeywordMatches = keywords.filter(k => title_lower.includes(k)).length;
            // 必须命中过半的词，避免只撞上一个字或一个词组就返回。
            if (titleKeywordMatches > 0 && titleKeywordMatches / keywords.length > 0.5) {
                score += 60 * (titleKeywordMatches / keywords.length);
            }
        }

        // 描述包含完整关键字
        if (spec_lower.includes(keyword)) {
            score += 40;
        }
        // 描述包含部分关键字
        else if (spec_lower) {
            const specKeywordMatches = keywords.filter(k => spec_lower.includes(k)).length;
            if (specKeywordMatches > 0 && specKeywordMatches / keywords.length > 0.5) {
                score += 20 * (specKeywordMatches / keywords.length);
            }
        }

        // 模块名/产品名匹配（加分项）
        if (moduleName_lower.includes(keyword) || productName_lower.includes(keyword)) {
            score += 10;
        }

        return score;
    }

    /**
     * 按产品名称搜索需求
     */
    async searchStoriesByProductName(productName: string, keyword: string, options?: {
        status?: StoryStatus;
        limit?: number;
    }): Promise<{ product: Product; stories: Story[] }[]> {
        try {
            // 获取所有产品
            const products = await this.getProducts();

            // 按产品名称过滤
            const matchedProducts = products.filter(product =>
                product.name.toLowerCase().includes(productName.toLowerCase())
            );

            const results: { product: Product; stories: Story[] }[] = [];

            for (const product of matchedProducts) {
                try {
                    const stories = await this.searchStories(keyword, {
                        productId: product.id,
                        status: options?.status,
                        limit: options?.limit
                    });

                    if (stories.length > 0) {
                        results.push({ product, stories });
                    }
                } catch (error) {
                    continue;
                }
            }

            return results;

        } catch (error) {
            console.error('按产品名称搜索需求失败:', error);
            throw new Error(`按产品名称搜索需求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 获取产品的测试用例列表
     * @param productId 产品ID
     * @param status 用例状态
     * @param moduleId 模块ID（可选）
     */
    async getProductTestCases(productId: number, status?: TestCaseStatus, moduleId?: number): Promise<TestCase[]> {

        try {
            // 禅道11.x API路径：/testcase-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
            // 当 browseType = 'byModule' 时，param 是模块ID
            // 当 browseType 是状态时，param 是 0

            let browseType: string;
            let param: number | string;

            if (moduleId) {
                // 按模块浏览
                browseType = 'byModule';
                param = moduleId;
            } else if (status && status !== 'all') {
                // 按状态浏览
                browseType = status;
                param = 0;
            } else {
                // 浏览全部
                browseType = 'all';
                param = 0;
            }

            const allCases: any[] = [];
            let currentPage = 1;
            const pageSize = 100;
            let hasMore = true;

            while (hasMore) {
                const url = `/testcase-browse-${productId}-0-${browseType}-${param}-id_desc-0-${pageSize}-${currentPage}.json`;
            const data = await this.request<any>(url);
            const cases = data.cases || {};
            const casesArray = Object.values(cases);

                allCases.push(...casesArray);
                hasMore = this.hasNextPage(data.pager, currentPage, casesArray.length);

                currentPage++;

                // 安全限制：最多获取100页
                if (currentPage > 100) {
                    break;
                }
            }

            let mappedCases = allCases.map((testCase: any) => ({
                id: parseInt(testCase.id),
                product: parseInt(testCase.product),
                module: this.linkedId(testCase.module) || undefined,
                story: this.linkedId(testCase.story) || undefined,
                title: testCase.title,
                type: testCase.type,
                pri: parseInt(testCase.pri),
                status: testCase.status,
                precondition: testCase.precondition || '',
                steps: testCase.steps || '',
                openedBy: testCase.openedBy,
                openedDate: testCase.openedDate,
                lastEditedBy: testCase.lastEditedBy,
                lastEditedDate: testCase.lastEditedDate,
            }));

            // 如果同时指定了 moduleId 和 status，需要在本地进行状态过滤
            // 因为禅道API的 browseType 只能是一个值（要么 byModule，要么状态）
            if (moduleId && status && status !== 'all') {
                mappedCases = mappedCases.filter(testCase => testCase.status === status);
            }

            return mappedCases;
        } catch (error) {
            console.error('获取测试用例列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取测试用例详情
     */
    async getTestCaseDetail(caseId: number): Promise<TestCase> {
        try {
            const data = await this.request<any>(`/testcase-view-${caseId}.json`);
            const testCase = data.case;

            let productName = data.product?.name as string | undefined;
            if (!productName && this.linkedId(testCase.product)) {
                const products = await this.getProducts();
                productName = products.find(item => item.id === parseInt(testCase.product))?.name;
            }

            return {
                id: parseInt(testCase.id),
                product: parseInt(testCase.product),
                productName,
                module: this.linkedId(testCase.module) || undefined,
                moduleName: testCase.moduleName,
                story: this.linkedId(testCase.story) || undefined,
                title: testCase.title,
                type: testCase.type,
                pri: parseInt(testCase.pri),
                status: testCase.status,
                precondition: testCase.precondition || '',
                steps: this.stepsText(testCase.steps),
                openedBy: testCase.openedBy,
                openedDate: testCase.openedDate,
                lastEditedBy: testCase.lastEditedBy,
                lastEditedDate: testCase.lastEditedDate,
            };
        } catch (error) {
            console.error('获取测试用例详情失败:', error);
            throw error;
        }
    }

    /**
     * 创建测试用例
     */
    async createTestCase(testCase: CreateTestCaseRequest): Promise<number> {
        try {
            const fields: Record<string, string | number> = {
                product: testCase.product,
                title: testCase.title,
                type: testCase.type || 'feature',
                pri: testCase.pri || 3,
                module: testCase.module || 0,
                story: testCase.story || 0,
                precondition: testCase.precondition || '',
            };
            // 11.3 只认 steps[n] / expects[n]，单个 steps 字符串不会写入步骤。
            const lines = (testCase.steps || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            lines.forEach((line, index) => {
                const n = index + 1;
                fields[`steps[${n}]`] = line.replace(/^\d+[.、]\s*/, '');
                fields[`expects[${n}]`] = '';
                fields[`stepType[${n}]`] = 'step';
            });

            const data = await this.postRequest<any>(`/testcase-create-${testCase.product}.json`, fields);
            const located = String(data?.locate || '').match(/testcase-view-(\d+)/);
            if (located) {
                return parseInt(located[1], 10);
            }
            const directId = parseInt(String(data?.id ?? ''), 10);
            if (directId > 0) {
                return directId;
            }

            // 成功时 locate 经常是用例列表，没有新编号。按标题回查，列表是 id 倒序。
            const cases = await this.getProductTestCases(testCase.product, 'all');
            const found = cases.find(item => item.title === testCase.title);
            if (found) {
                return found.id;
            }
            throw new Error('测试用例已提交，但没有拿到编号');
        } catch (error) {
            console.error('创建测试用例失败:', error);
            throw error;
        }
    }

    /**
     * 获取需求的测试用例
     */
    async getStoryTestCases(storyId: number): Promise<TestCase[]> {
        try {
            const data = await this.request<any>(`/story-view-${storyId}.json`);
            const cases = data.cases || {};
            const casesArray = Object.values(cases);

            const mappedCases = casesArray.map((testCase: any) => ({
                id: parseInt(testCase.id),
                title: testCase.title,
                type: testCase.type,
                pri: parseInt(testCase.pri),
                status: testCase.status,
            }));

            return mappedCases;
        } catch (error) {
            console.error('获取需求测试用例失败:', error);
            return [];
        }
    }

    /**
     * 获取测试单列表
     */
    async getTestTasks(productId?: number): Promise<TestTask[]> {
        try {
            // 禅道11.x API路径：/testtask-browse-{productId}.json
            const url = productId ? `/testtask-browse-${productId}.json` : '/my-testtask.json';

            const data = await this.request<any>(url);
            const tasks = data.tasks || {};
            const tasksArray = Object.values(tasks);

            const mappedTasks = tasksArray.map((task: any) => ({
                id: parseInt(task.id),
                name: task.name,
                product: parseInt(task.product),
                productName: task.productName,
                project: task.project ? parseInt(task.project) : undefined,
                execution: task.execution ? parseInt(task.execution) : undefined,
                build: task.build,
                owner: task.owner,
                status: task.status,
                begin: task.begin,
                end: task.end,
                desc: task.desc || '',
            }));

            return mappedTasks;
        } catch (error) {
            console.error('获取测试单列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取测试单详情
     */
    async getTestTaskDetail(taskId: number): Promise<TestTask> {
        try {
            const data = await this.request<any>(`/testtask-view-${taskId}.json`);
            const task = data.task;

            return {
                id: parseInt(task.id),
                name: task.name,
                product: parseInt(task.product),
                productName: data.product?.name,
                project: task.project ? parseInt(task.project) : undefined,
                execution: task.execution ? parseInt(task.execution) : undefined,
                build: task.build,
                owner: task.owner,
                status: task.status,
                begin: task.begin,
                end: task.end,
                desc: task.desc || '',
            };
        } catch (error) {
            console.error('获取测试单详情失败:', error);
            throw error;
        }
    }

    /**
     * 获取测试单的测试结果
     */
    async getTestTaskResults(taskId: number): Promise<TestResult[]> {
        try {
            const data = await this.request<any>(`/testtask-cases-${taskId}.json`);
            const runs = data.runs || {};
            const runsArray = Object.values(runs);

            const mappedResults = runsArray.map((run: any) => ({
                id: parseInt(run.id),
                // 列表行的 id 是执行记录。run 也用它，方便交给 runTestCase。
                run: parseInt(run.id),
                case: parseInt(run.case),
                caseTitle: run.title,
                version: parseInt(run.version),
                status: run.caseStatus,
                lastRunner: run.lastRunner,
                lastRunDate: run.lastRunDate,
                lastRunResult: run.lastRunResult,
            }));

            return mappedResults;
        } catch (error) {
            console.error('获取测试结果失败:', error);
            return [];
        }
    }

    /**
     * 执行测试用例
     */
    async runTestCase(taskId: number, testRun: TestRunRequest): Promise<void> {
        try {
            const version = testRun.version || 1;
            const detail = await this.request<any>(`/testcase-view-${testRun.caseId}.json`);
            const rawSteps = detail.case?.steps;
            const stepList = !rawSteps ? [] : (Array.isArray(rawSteps) ? rawSteps : Object.values(rawSteps));
            const stepIds = stepList
                .map((step: any) => step?.id)
                .filter((id: unknown) => id !== undefined && id !== null && String(id) !== '');
            // 结果表没有 comment 列。页面是按步骤编号提交 steps[id] / reals[id]。
            const fields: Record<string, string | number> = {
                case: testRun.caseId,
                version: detail.case?.version || version,
            };
            const actual = [testRun.comment, testRun.steps].filter(Boolean).join('\n');
            for (const stepId of (stepIds.length ? stepIds : [0])) {
                fields[`steps[${stepId}]`] = testRun.result === 'skipped' ? 'n/a' : testRun.result;
                fields[`reals[${stepId}]`] = actual;
            }
            await this.postRequest(`/testtask-runCase-${taskId}-${testRun.caseId}-${version}.json`, fields);
        } catch (error) {
            console.error('执行测试用例失败:', error);
            throw error;
        }
    }

    /**
     * 获取需求关联的 Bug 列表
     */
    async getStoryRelatedBugs(storyId: number): Promise<Bug[]> {
        try {
            const story = await this.getStoryDetail(storyId);
            const productId = this.linkedId(story.product);
            // 我的 Bug 只包含指派给自己的。产品里未指派的 Bug 会漏掉。
            const bugs = productId
                ? await this.getProductBugs(productId, 'all')
                : await this.getMyBugs();
            return bugs.filter(bug => this.linkedId(bug.story) === storyId);
        } catch (error) {
            console.error(`获取需求 ${storyId} 关联的 Bug 失败:`, error);
            throw error;
        }
    }

    /**
     * 获取 Bug 关联的需求
     */
    async getBugRelatedStory(bugId: number): Promise<Story | null> {
        try {
            const bug = await this.getBugDetail(bugId);
            const storyId = this.linkedId(bug.story);
            if (!storyId) {
                return null;
            }

            return await this.getStoryDetail(storyId);
        } catch (error) {
            console.error(`获取 Bug ${bugId} 关联的需求失败:`, error);
            return null;
        }
    }

    private locateId(data: any, pattern: RegExp): number {
        const sources = [data?.locate, data?.message, typeof data === 'string' ? data : ''];
        for (const source of sources) {
            const matched = String(source ?? '').match(pattern);
            if (!matched) {
                continue;
            }
            const id = parseInt(matched[1], 10);
            if (id > 0) {
                return id;
            }
        }
        const direct = parseInt(String(data?.id ?? ''), 10);
        return Number.isFinite(direct) && direct > 0 ? direct : 0;
    }

    private daySpan(begin: string, end: string): number {
        const start = Date.parse(`${begin}T00:00:00Z`);
        const stop = Date.parse(`${end}T00:00:00Z`);
        if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
            return 1;
        }
        return Math.round((stop - start) / 86400000);
    }

    /** 项目任务、版本列表有时是对象，有时按需求再套一层数组。 */
    private collectRecords(value: unknown): any[] {
        if (!value || typeof value !== 'object') {
            return [];
        }
        if (Array.isArray(value)) {
            return value.flatMap(item => this.collectRecords(item));
        }
        const record = value as Record<string, unknown>;
        if (record.id !== undefined && (record.name !== undefined || record.title !== undefined)) {
            return [record];
        }
        return Object.values(record).flatMap(item => this.collectRecords(item));
    }

    private mapTask(task: any): Task {
        const story = this.linkedId(task?.story);
        const project = this.linkedId(task?.project);
        return {
            id: parseInt(task.id),
            name: task.name,
            status: task.status as TaskStatus,
            pri: parseInt(task.pri) || 0,
            deadline: task.deadline,
            desc: task.desc || '',
            story: story || undefined,
            product: task.product || undefined,
            project: project || undefined,
            assignedTo: task.assignedTo || undefined,
        };
    }

    private mapProject(project: any): Project {
        return {
            id: parseInt(project.id),
            name: String(project.name ?? ''),
            code: project.code || '',
            status: project.status || '',
            begin: project.begin || undefined,
            end: project.end || undefined,
            desc: project.desc || '',
            type: project.type || undefined,
        };
    }

    private projectPairs(projects: unknown): Project[] {
        if (!projects || typeof projects !== 'object') {
            return [];
        }
        const entries = Array.isArray(projects)
            ? projects.map((name, index) => [String(index), name] as const)
            : Object.entries(projects as Record<string, unknown>);
        return entries.map(([id, value]) => {
            if (value && typeof value === 'object') {
                return this.mapProject({ ...(value as object), id: (value as any).id || id });
            }
            return this.mapProject({ id, name: value });
        }).filter(project => project.id > 0 && project.name);
    }

    async getProjects(): Promise<Project[]> {
        try {
            const data = await this.request<any>('/project-all.json');
            const projects = this.collectRecords(data.projectStats)
                .map(item => this.mapProject(item))
                .filter(project => project.id > 0 && project.name);
            if (projects.length > 0) {
                return projects;
            }
        } catch (error) {
            console.error('获取项目统计失败，改用项目索引:', error);
        }

        const data = await this.request<any>('/project-index.json');
        return this.projectPairs(data.projects);
    }

    async getProject(projectId: number): Promise<Project> {
        const data = await this.request<any>(`/project-view-${projectId}.json`);
        return this.mapProject(data.project || data);
    }

    async createProject(input: CreateProjectRequest): Promise<Project> {
        const products = (input.products || []).filter(id => id > 0);
        if (products.length === 0) {
            throw new Error('创建项目需要关联至少一个产品');
        }
        if (input.end <= input.begin) {
            throw new Error('项目结束日期必须晚于开始日期');
        }
        const fields: Record<string, string | number> = {
            name: input.name,
            code: input.code,
            begin: input.begin,
            end: input.end,
            days: input.days && input.days > 0 ? input.days : this.daySpan(input.begin, input.end),
            team: input.team || input.name,
            type: input.type || 'sprint',
            acl: input.acl || 'open',
            desc: input.desc || '',
        };
        products.forEach((productId, index) => {
            fields[`products[${index}]`] = productId;
        });
        const data = await this.postRequest<any>('/project-create.json', fields);
        let projectId = this.locateId(data, /project-(?:create|view)-(\d+)/);
        if (!projectId) {
            const found = (await this.getProjects()).find(project => project.code === input.code);
            projectId = found?.id ?? 0;
        }
        if (!projectId) {
            throw new Error('项目已提交，但没有拿到编号');
        }
        return this.getProject(projectId);
    }

    async deleteProject(projectId: number): Promise<void> {
        await this.request(`/project-delete-${projectId}-yes.json`);
    }

    async getProjectTasks(projectId: number): Promise<Task[]> {
        const data = await this.request<any>(`/project-task-${projectId}-all-0-id_desc.json`);
        return this.collectRecords(data.tasks).map(task => this.mapTask(task));
    }

    async createTask(input: CreateTaskRequest): Promise<Task> {
        const storyId = input.story || 0;
        const fields: Record<string, string | number> = {
            name: input.name,
            type: input.type || 'devel',
            pri: input.pri || 3,
            estimate: input.estimate ?? 0,
            desc: input.desc || '',
            estStarted: input.estStarted || this.today(),
            story: storyId,
            // 模型按数组遍历指派人。缺这个字段时一条任务都不会建。
            'assignedTo[]': input.assignedTo || '',
        };
        if (input.deadline) {
            fields.deadline = input.deadline;
        }
        const data = await this.postRequest<any>(`/task-create-${input.project}-${storyId}.json`, fields);
        let taskId = this.locateId(data, /task-view-(\d+)/);
        if (!taskId) {
            const found = (await this.getProjectTasks(input.project))
                .filter(task => task.name === input.name)
                .sort((a, b) => b.id - a.id)[0];
            taskId = found?.id ?? 0;
        }
        if (!taskId) {
            throw new Error('任务已提交，但没有拿到编号');
        }
        return this.getTaskDetail(taskId);
    }

    async startTask(taskId: number, options: { consumed?: number; left?: number } = {}): Promise<Task> {
        const current = (await this.request<any>(`/task-view-${taskId}.json`)).task;
        const currentLeft = Number(current.left || 0);
        const estimate = Number(current.estimate || 0);
        // 剩余为 0 时，11.3 会直接把任务完成并指回创建人。
        const left = options.left ?? (currentLeft > 0 ? currentLeft : (estimate > 0 ? estimate : 1));
        await this.postRequest(`/task-start-${taskId}.json`, {
            consumed: options.consumed ?? Number(current.consumed || 0),
            left,
            realStarted: this.today(),
        });
        return this.getTaskDetail(taskId);
    }

    async closeTask(taskId: number, comment = ''): Promise<Task> {
        await this.postRequest(`/task-close-${taskId}.json`, {
            closedReason: 'done',
            comment,
        });
        return this.getTaskDetail(taskId);
    }

    async assignTask(taskId: number, assignedTo: string, options: { left?: number; comment?: string } = {}): Promise<Task> {
        const current = (await this.request<any>(`/task-view-${taskId}.json`)).task;
        const projectId = this.linkedId(current.project);
        if (!projectId) {
            throw new Error(`任务 ${taskId} 没有项目，不能指派`);
        }
        const currentLeft = Number(current.left || 0);
        await this.postRequest(`/task-assignTo-${projectId}-${taskId}.json`, {
            assignedTo,
            left: options.left ?? (currentLeft > 0 ? currentLeft : 1),
            comment: options.comment || '',
        });
        return this.getTaskDetail(taskId);
    }

    async deleteTask(taskId: number): Promise<void> {
        const current = (await this.request<any>(`/task-view-${taskId}.json`)).task;
        const projectId = this.linkedId(current.project);
        if (!projectId) {
            throw new Error(`任务 ${taskId} 没有项目，不能删除`);
        }
        await this.request(`/task-delete-${projectId}-${taskId}-yes.json`);
    }

    async createBug(input: CreateBugRequest): Promise<Bug> {
        const data = await this.postRequest<any>(`/bug-create-${input.product}-0-0.json`, {
            product: input.product,
            title: input.title,
            openedBuild: input.openedBuild || 'trunk',
            severity: input.severity || 3,
            pri: input.pri || 3,
            type: input.type || 'codeerror',
            steps: input.steps || '',
            story: input.story || 0,
            assignedTo: input.assignedTo || '',
        });
        let bugId = this.locateId(data, /bug-view-(\d+)/);
        if (!bugId) {
            const found = (await this.getProductBugs(input.product, 'all'))
                .filter(bug => bug.title === input.title)
                .sort((a, b) => b.id - a.id)[0];
            bugId = found?.id ?? 0;
        }
        if (!bugId) {
            throw new Error('Bug 已提交，但没有拿到编号');
        }
        return this.getBugDetail(bugId);
    }

    async closeBug(bugId: number, comment = ''): Promise<Bug> {
        await this.postRequest(`/bug-close-${bugId}.json`, { comment });
        return this.getBugDetail(bugId);
    }

    async activateBug(bugId: number, options: { assignedTo?: string; comment?: string } = {}): Promise<Bug> {
        await this.postRequest(`/bug-activate-${bugId}.json`, {
            assignedTo: options.assignedTo,
            comment: options.comment || '',
        });
        return this.getBugDetail(bugId);
    }

    async assignBug(bugId: number, assignedTo: string, comment = ''): Promise<Bug> {
        await this.postRequest(`/bug-assignTo-${bugId}.json`, { assignedTo, comment });
        return this.getBugDetail(bugId);
    }

    async deleteBug(bugId: number): Promise<void> {
        await this.request(`/bug-delete-${bugId}-yes.json`);
    }

    async createStory(input: CreateStoryRequest): Promise<Story> {
        const fields: Record<string, string | number> = {
            product: input.product,
            title: input.title,
            spec: input.spec || '',
            verify: input.verify || '',
            pri: input.pri || 3,
            estimate: input.estimate || 0,
            assignedTo: input.assignedTo || '',
            source: input.source || '',
        };
        if (input.needNotReview !== false) {
            fields.needNotReview = 1;
        }
        const data = await this.postRequest<any>(`/story-create-${input.product}.json`, fields);
        let storyId = this.locateId(data, /story-view-(\d+)/);
        if (!storyId) {
            const found = (await this.getProductStories(input.product, 'all'))
                .filter(story => story.title === input.title)
                .sort((a, b) => b.id - a.id)[0];
            storyId = found?.id ?? 0;
        }
        if (!storyId) {
            throw new Error('需求已提交，但没有拿到编号');
        }
        return this.getStoryDetail(storyId);
    }

    async changeStory(storyId: number, input: ChangeStoryRequest): Promise<Story> {
        const current = (await this.request<any>(`/story-view-${storyId}.json`)).story;
        await this.postRequest(`/story-change-${storyId}.json`, {
            title: input.title || current.title,
            spec: input.spec ?? current.spec ?? '',
            verify: input.verify ?? current.verify ?? '',
            assignedTo: input.assignedTo ?? current.assignedTo ?? '',
            comment: input.comment || '',
        });
        return this.getStoryDetail(storyId);
    }

    async closeStory(storyId: number, closedReason: string, comment = ''): Promise<Story> {
        await this.postRequest(`/story-close-${storyId}.json`, { closedReason, comment });
        return this.getStoryDetail(storyId);
    }

    async activateStory(storyId: number, options: { assignedTo?: string; comment?: string } = {}): Promise<Story> {
        const current = (await this.request<any>(`/story-view-${storyId}.json`)).story;
        await this.postRequest(`/story-activate-${storyId}.json`, {
            assignedTo: options.assignedTo || current.assignedTo || '',
            status: 'active',
            comment: options.comment || '',
        });
        return this.getStoryDetail(storyId);
    }

    async deleteStory(storyId: number): Promise<void> {
        await this.request(`/story-delete-${storyId}-yes.json`);
    }

    async getProjectBuilds(projectId: number): Promise<Build[]> {
        const data = await this.request<any>(`/project-build-${projectId}.json`);
        // 11.3 放在 projectBuilds 里，按产品再套一层数组。
        return this.collectRecords(data.projectBuilds || data.builds)
            .filter(build => String(build.deleted ?? '0') !== '1')
            .map(build => ({
                id: parseInt(build.id),
                name: build.name,
                project: this.linkedId(build.project) || projectId,
                product: this.linkedId(build.product) || undefined,
                builder: build.builder || undefined,
                date: build.date || undefined,
            }));
    }

    async createBuild(input: CreateBuildRequest): Promise<Build> {
        const data = await this.postRequest<any>(`/build-create-${input.project}.json`, {
            product: input.product,
            name: input.name,
            builder: input.builder || this.config.username,
            date: input.date || this.today(),
            desc: input.desc || '',
        });
        let buildId = this.locateId(data, /build-view-(\d+)/);
        if (!buildId) {
            const found = (await this.getProjectBuilds(input.project))
                .filter(build => build.name === input.name)
                .sort((a, b) => b.id - a.id)[0];
            buildId = found?.id ?? 0;
        }
        if (!buildId) {
            throw new Error('版本已提交，但没有拿到编号');
        }
        const builds = await this.getProjectBuilds(input.project);
        const build = builds.find(item => item.id === buildId);
        return build ?? { id: buildId, name: input.name, project: input.project, product: input.product };
    }

    async deleteBuild(buildId: number): Promise<void> {
        await this.request(`/build-delete-${buildId}-yes.json`);
    }

    async createTestTask(input: CreateTestTaskRequest): Promise<TestTask> {
        await this.postRequest(`/testtask-create-${input.product}-${input.project}.json`, {
            product: input.product,
            project: input.project,
            build: input.build,
            name: input.name,
            begin: input.begin,
            end: input.end,
            owner: input.owner || this.config.username,
            desc: input.desc || '',
        });
        const found = (await this.getTestTasks(input.product))
            .filter(task => task.name === input.name)
            .sort((a, b) => b.id - a.id)[0];
        if (!found) {
            throw new Error('测试单已提交，但没有拿到编号');
        }
        return found;
    }

    async linkTestCase(taskId: number, caseId: number, version?: number): Promise<void> {
        let caseVersion = version;
        if (!caseVersion) {
            const detail = await this.request<any>(`/testcase-view-${caseId}.json`);
            caseVersion = parseInt(detail.case?.version, 10) || 1;
        }
        await this.postRequest(`/testtask-linkCase-${taskId}.json`, {
            'cases[]': caseId,
            [`versions[${caseId}]`]: caseVersion,
        });
    }

    async deleteTestTask(taskId: number): Promise<void> {
        await this.request(`/testtask-delete-${taskId}-yes.json`);
    }

    async deleteTestCase(caseId: number): Promise<void> {
        await this.request(`/testcase-delete-${caseId}-yes.json`);
    }
}

