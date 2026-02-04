/**
 * 禅道旧版API (11.x版本)
 * 使用Session认证方式
 */
import axios from 'axios';
export class ZentaoLegacyAPI {
    constructor(config) {
        this.sessionId = null;
        this.config = config;
        // 禅道11.x使用的是传统的URL格式，不是RESTful API
        this.client = axios.create({
            baseURL: this.config.url,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
    }
    /**
     * 获取SessionID
     */
    async getSessionId() {
        if (this.sessionId)
            return this.sessionId;
        try {
            const response = await this.client.get('/api-getSessionID.json');
            if (response.data.status === 'success') {
                const data = JSON.parse(response.data.data);
                this.sessionId = data.sessionID;
                return this.sessionId;
            }
            throw new Error(`获取SessionID失败: ${JSON.stringify(response.data)}`);
        }
        catch (error) {
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
    async login() {
        const sid = await this.getSessionId();
        try {
            const params = new URLSearchParams();
            params.append('account', this.config.username);
            params.append('password', this.config.password);
            params.append('keepLogin[]', 'on');
            params.append('referer', `${this.config.url}/my/`);
            const response = await this.client.post(`/user-login.json?zentaosid=${sid}`, params);
            if (response.data.status === 'success') {
                return;
            }
            throw new Error(`登录失败: ${JSON.stringify(response.data)}`);
        }
        catch (error) {
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
    async ensureLoggedIn() {
        if (!this.sessionId) {
            await this.login();
        }
        return this.sessionId;
    }
    /**
     * 强制重新登录（清除sessionId后重新登录）
     */
    async forceReLogin() {
        this.sessionId = null;
        await this.login();
        if (!this.sessionId) {
            throw new Error('重新登录失败：未能获取sessionId');
        }
        return this.sessionId;
    }
    /**
     * 检测响应是否为会话过期（重定向到登录页面）
     */
    isSessionExpired(responseData) {
        if (typeof responseData === 'string') {
            // 检测HTML重定向到登录页面
            return responseData.includes('user-login') ||
                responseData.includes('self.location') ||
                responseData.includes('<script>');
        }
        return false;
    }
    /**
     * 发起请求（带自动重试）
     */
    async request(url, params, retried = false) {
        const sid = await this.ensureLoggedIn();
        try {
            const fullUrl = `${url}?zentaosid=${sid}`;
            const response = await this.client.get(fullUrl, { params });
            // 检测会话过期
            if (this.isSessionExpired(response.data)) {
                if (!retried) {
                    console.log('检测到会话过期，正在重新登录...');
                    await this.forceReLogin();
                    return this.request(url, params, true);
                }
                throw new Error('会话已过期，重新登录后仍然失败');
            }
            if (response.data.status === 'success') {
                return JSON.parse(response.data.data);
            }
            throw new Error(`请求失败: ${JSON.stringify(response.data)}`);
        }
        catch (error) {
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
    async postRequest(url, data, retried = false) {
        const sid = await this.ensureLoggedIn();
        try {
            const fullUrl = `${url}?zentaosid=${sid}`;
            const params = new URLSearchParams();
            if (data) {
                Object.keys(data).forEach(key => {
                    params.append(key, data[key]);
                });
            }
            const response = await this.client.post(fullUrl, params);
            // 检测会话过期
            if (this.isSessionExpired(response.data)) {
                if (!retried) {
                    console.log('检测到会话过期，正在重新登录...');
                    await this.forceReLogin();
                    return this.postRequest(url, data, true);
                }
                throw new Error('会话已过期，重新登录后仍然失败');
            }
            if (response.data.status === 'success') {
                return response.data.data ? JSON.parse(response.data.data) : response.data;
            }
            throw new Error(`请求失败: ${JSON.stringify(response.data)}`);
        }
        catch (error) {
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
     * 获取产品列表
     */
    async getProducts() {
        const data = await this.request('/product-index-no.json');
        const products = data.products || {};
        return Object.keys(products).map(id => ({
            id: parseInt(id),
            name: products[id],
            code: '',
            status: 'normal',
            desc: ''
        }));
    }
    /**
     * 获取产品的模块树
     * @param productId 产品ID
     * @returns 模块树对象，key是模块ID，value是模块名称
     */
    async getProductModules(productId) {
        try {
            // 尝试多个可能的API路径
            const paths = [
                `/product-browse-${productId}.json`, // 产品浏览页面
                `/story-create-${productId}.json`, // 创建需求页面（包含模块树）
            ];
            for (const apiPath of paths) {
                try {
                    const data = await this.request(apiPath);
                    const modules = data.modules || data.moduleTree || {};
                    if (Object.keys(modules).length > 0) {
                        // modules 格式: { "1296": "家族养成游戏道具兑换——肖仲政", ... }
                        return modules;
                    }
                }
                catch (err) {
                    // 继续尝试下一个路径
                    continue;
                }
            }
            return {};
        }
        catch (error) {
            console.error(`获取产品${productId}的模块树失败:`, error);
            return {};
        }
    }
    /**
     * 获取我的任务列表
     */
    async getMyTasks() {
        const data = await this.request('/my-task.json');
        const tasks = data.tasks || {};
        return Object.values(tasks).map((task) => ({
            id: parseInt(task.id),
            name: task.name,
            status: task.status,
            pri: parseInt(task.pri),
            deadline: task.deadline,
            desc: task.desc || '',
        }));
    }
    /**
     * 获取任务详情
     */
    async getTaskDetail(taskId) {
        const data = await this.request(`/task-view-${taskId}.json`);
        const task = data.task;
        return {
            id: parseInt(task.id),
            name: task.name,
            status: task.status,
            pri: parseInt(task.pri),
            deadline: task.deadline,
            desc: task.desc || '',
            story: task.story || undefined,
            product: task.product || undefined,
        };
    }
    /**
     * 获取我的Bug列表
     */
    async getMyBugs() {
        const data = await this.request('/my-bug.json');
        const bugs = data.bugs || {};
        return Object.values(bugs).map((bug) => ({
            id: parseInt(bug.id),
            title: bug.title,
            status: bug.status,
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
    async getProductBugs(productId, status, moduleId) {
        try {
            // 禅道11.x API路径：/bug-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
            // 当 browseType = 'byModule' 时，param 是模块ID
            // 当 browseType 是状态时，param 是 0
            let browseType;
            let param = 0;
            if (moduleId) {
                // 按模块浏览
                browseType = 'byModule';
                param = moduleId;
            }
            else if (status && status !== 'all') {
                // 按状态浏览
                browseType = status;
                param = 0;
            }
            else {
                // 浏览全部
                browseType = 'all';
                param = 0;
            }
            const allBugs = [];
            let currentPage = 1;
            const pageSize = 100;
            let hasMore = true;
            while (hasMore) {
                const url = `/bug-browse-${productId}-0-${browseType}-${param}-id_desc-0-${pageSize}-${currentPage}.json`;
                const data = await this.request(url);
                const bugs = data.bugs || {};
                const bugsArray = Object.values(bugs);
                allBugs.push(...bugsArray);
                // 检查分页信息
                if (data.pager) {
                    const { recTotal, recPerPage, pageID } = data.pager;
                    const totalPages = Math.ceil(recTotal / recPerPage);
                    hasMore = currentPage < totalPages && bugsArray.length > 0;
                }
                else {
                    hasMore = false;
                }
                currentPage++;
                // 安全限制：最多获取100页
                if (currentPage > 100) {
                    break;
                }
            }
            let mappedBugs = allBugs.map((bug) => ({
                id: parseInt(bug.id),
                title: bug.title,
                status: bug.status,
                severity: parseInt(bug.severity),
                steps: bug.steps || '',
                openedDate: bug.openedDate,
                product: bug.product ? parseInt(bug.product) : undefined,
                module: bug.module ? parseInt(bug.module) : undefined,
            }));
            // 如果同时指定了 moduleId 和 status，需要在本地进行状态过滤
            // 因为禅道API的 browseType 只能是一个值（要么 byModule，要么状态）
            if (moduleId && status && status !== 'all') {
                mappedBugs = mappedBugs.filter(bug => bug.status === status);
            }
            return mappedBugs;
        }
        catch (error) {
            console.error('获取产品Bug列表失败:', error);
            throw error;
        }
    }
    /**
     * 获取Bug详情
     */
    async getBugDetail(bugId) {
        const data = await this.request(`/bug-view-${bugId}.json`);
        const bug = data.bug;
        const product = data.product;
        return {
            id: parseInt(bug.id),
            title: bug.title,
            status: bug.status,
            severity: parseInt(bug.severity),
            steps: bug.steps || '',
            openedDate: bug.openedDate,
            story: bug.story || undefined,
            product: bug.product || undefined,
            productName: product?.name || undefined,
        };
    }
    /**
     * 更新任务
     */
    async updateTask(taskId, update) {
        await this.postRequest(`/task-edit-${taskId}.json`, {
            consumed: update.consumed,
            left: update.left,
            status: update.status,
            comment: update.comment || '',
        });
        // 返回更新后的任务详情
        return await this.getTaskDetail(taskId);
    }
    /**
     * 完成任务
     */
    async finishTask(taskId, update) {
        await this.postRequest(`/task-finish-${taskId}.json`, {
            consumed: update.consumed || 0,
            finishedDate: update.finishedDate || new Date().toISOString().split('T')[0],
            comment: update.comment || '',
        });
    }
    /**
     * 解决Bug
     */
    async resolveBug(bugId, resolution) {
        await this.postRequest(`/bug-resolve-${bugId}.json`, {
            resolution: resolution.resolution,
            resolvedBuild: resolution.resolvedBuild || '',
            comment: resolution.comment || '',
        });
    }
    /**
     * 获取产品的需求列表（支持分页，自动获取所有需求）
     * @param productId 产品ID
     * @param status 需求状态（可选）
     * @param moduleId 模块ID（可选），当提供时，只获取该模块下的需求
     */
    async getProductStories(productId, status, moduleId) {
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
        const allStories = [];
        let currentPage = 1;
        const pageSize = 100; // 每页获取100条
        let hasMore = true;
        // 映射status参数到browseType
        // 注意：禅道11.x的browseType只支持简单的值，不像RESTful API那样复杂
        let browseType;
        let param = 0;
        if (moduleId) {
            // 按模块浏览
            browseType = 'byModule';
            param = moduleId;
        }
        else {
            browseType = 'unclosed'; // 默认获取未关闭的需求
            if (status) {
                switch (status) {
                    case 'all':
                        browseType = 'unclosed'; // 11.x中all返回0条，所以用unclosed代替
                        break;
                    case 'active':
                        browseType = 'unclosed'; // active也映射到unclosed
                        break;
                    case 'draft':
                        browseType = 'unclosed'; // draft也映射到unclosed
                        break;
                    case 'closed':
                        browseType = 'unclosed'; // closed也映射到unclosed
                        break;
                    case 'changed':
                        browseType = 'unclosed'; // changed也映射到unclosed
                        break;
                    default:
                        browseType = 'unclosed';
                }
            }
        }
        while (hasMore) {
            // 构建URL：/product-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
            const url = `/product-browse-${productId}-0-${browseType}-${param}-id_desc-0-${pageSize}-${currentPage}.json`;
            const data = await this.request(url);
            const stories = data.stories || {};
            const storiesArray = Object.values(stories);
            // 添加到结果数组
            allStories.push(...storiesArray);
            // 检查分页信息
            if (data.pager) {
                const { recTotal, recPerPage, pageID } = data.pager;
                const totalPages = Math.ceil(recTotal / recPerPage);
                // 判断是否还有更多数据
                hasMore = currentPage < totalPages && storiesArray.length > 0;
            }
            else {
                // 没有分页信息，说明没有更多数据
                hasMore = false;
            }
            currentPage++;
            // 安全限制：最多获取100页，避免无限循环
            if (currentPage > 100) {
                break;
            }
        }
        // 映射为标准格式
        let mappedStories = allStories.map((story) => ({
            id: parseInt(story.id),
            title: story.title,
            status: story.status,
            pri: parseInt(story.pri),
            stage: story.stage,
            estimate: story.estimate ? parseFloat(story.estimate) : undefined,
            openedBy: story.openedBy,
            openedDate: story.openedDate,
            assignedTo: story.assignedTo,
            spec: story.spec || '',
        }));
        // 如果同时指定了 moduleId 和 status，需要在本地进行状态过滤
        // 因为禅道API的 browseType 只能是一个值（要么 byModule，要么状态）
        if (moduleId && status && status !== 'all') {
            mappedStories = mappedStories.filter(story => story.status === status);
        }
        return mappedStories;
    }
    /**
     * 获取需求详情
     */
    async getStoryDetail(storyId) {
        const data = await this.request(`/story-view-${storyId}.json`);
        const story = data.story;
        const product = data.product;
        // 获取模块名称
        let moduleName;
        // 如果有模块ID，从模块树API获取模块名称
        if (story.module && story.module !== '0' && story.product) {
            try {
                const modules = await this.getProductModules(parseInt(story.product));
                moduleName = modules[story.module];
            }
            catch (error) {
                console.error('获取模块名称失败:', error);
            }
        }
        return {
            id: parseInt(story.id),
            title: story.title,
            status: story.status,
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
        };
    }
    /**
     * 下载需求中的图片文件
     */
    async downloadStoryImage(imageUrl) {
        const sid = await this.ensureLoggedIn();
        // 构建完整的图片URL
        let fullImageUrl;
        if (imageUrl.startsWith('/zentao/')) {
            // 移除重复的 /zentao 前缀
            const cleanUrl = imageUrl.replace('/zentao/', '/');
            fullImageUrl = `${this.config.url}${cleanUrl}`;
        }
        else if (imageUrl.startsWith('/')) {
            fullImageUrl = `${this.config.url}${imageUrl}`;
        }
        else {
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
    extractImageUrls(spec) {
        const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
        const images = [];
        let match;
        while ((match = imgRegex.exec(spec)) !== null) {
            images.push(match[1]);
        }
        return images;
    }
    /**
     * 提取需求描述中的文件ID
     */
    extractFileIds(spec) {
        const fileRegex = /file-read-(\d+)/g;
        const fileIds = [];
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
    async searchStories(keyword, options) {
        const { productId, status, limit = 50, deepSearch = false, startDate, endDate } = options || {};
        try {
            let allStories = [];
            if (productId) {
                // 搜索指定产品的需求
                allStories = await this.getProductStories(productId, status);
            }
            else {
                // 搜索所有产品的需求（全量搜索）
                const products = await this.getProducts();
                // 全量搜索：遍历所有产品
                for (const product of products) {
                    try {
                        const stories = await this.getProductStories(product.id, status);
                        allStories.push(...stories);
                    }
                    catch (error) {
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
            // 分词：将关键字拆分为多个词（支持中英文）
            const keywords = this.splitKeywords(keyword);
            const keyword_lower = keyword.toLowerCase();
            // 计算匹配度评分
            const scoredStories = allStories.map(story => {
                const score = this.calculateMatchScore(story, keyword_lower, keywords);
                return { story, score };
            }).filter(item => item.score > 0); // 只保留有匹配的
            // 如果启用深度搜索，对标题匹配但描述可能不完整的需求获取详情
            if (deepSearch) {
                const titleMatchedButLowScore = scoredStories
                    .filter(item => {
                    const titleMatch = item.story.title.toLowerCase().includes(keyword_lower);
                    const specMatch = item.story.spec && item.story.spec.toLowerCase().includes(keyword_lower);
                    return titleMatch && !specMatch && item.score < 50; // 标题匹配但描述不匹配，且评分较低
                })
                    .slice(0, 10); // 最多深度搜索10个
                for (const item of titleMatchedButLowScore) {
                    try {
                        const detail = await this.getStoryDetail(item.story.id);
                        // 使用完整描述重新计算评分
                        const newScore = this.calculateMatchScore(detail, keyword_lower, keywords);
                        if (newScore > item.score) {
                            item.story = detail;
                            item.score = newScore;
                        }
                    }
                    catch (error) {
                        // 忽略获取详情失败的情况
                        continue;
                    }
                }
            }
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
        }
        catch (error) {
            console.error('搜索需求失败:', error);
            throw new Error(`搜索需求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 分词：将关键字拆分为多个词
     * 支持中英文混合，中文按字符拆分，英文按单词拆分
     */
    splitKeywords(keyword) {
        const keywords = [];
        const lowerKeyword = keyword.toLowerCase();
        // 英文单词（字母、数字、连字符）
        const englishWords = lowerKeyword.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
        keywords.push(...englishWords);
        // 中文字符（每个字符作为一个词）
        const chineseChars = lowerKeyword.match(/[\u4e00-\u9fa5]/g) || [];
        keywords.push(...chineseChars);
        // 如果分词后没有结果，返回原始关键字
        if (keywords.length === 0) {
            keywords.push(lowerKeyword);
        }
        return keywords;
    }
    /**
     * 按时间范围过滤需求
     * @param stories 需求列表
     * @param startDate 开始时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @param endDate 结束时间（可选，格式：YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss）
     * @returns 过滤后的需求列表
     */
    filterByDateRange(stories, startDate, endDate) {
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
    parseDate(dateStr) {
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
    calculateMatchScore(story, keyword, keywords) {
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
            if (titleKeywordMatches > 0) {
                score += 60 * (titleKeywordMatches / keywords.length); // 按匹配比例计算
            }
        }
        // 描述包含完整关键字
        if (spec_lower.includes(keyword)) {
            score += 40;
        }
        // 描述包含部分关键字
        else if (spec_lower) {
            const specKeywordMatches = keywords.filter(k => spec_lower.includes(k)).length;
            if (specKeywordMatches > 0) {
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
    async searchStoriesByProductName(productName, keyword, options) {
        try {
            // 获取所有产品
            const products = await this.getProducts();
            // 按产品名称过滤
            const matchedProducts = products.filter(product => product.name.toLowerCase().includes(productName.toLowerCase()));
            const results = [];
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
                }
                catch (error) {
                    continue;
                }
            }
            return results;
        }
        catch (error) {
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
    async getProductTestCases(productId, status, moduleId) {
        try {
            // 禅道11.x API路径：/testcase-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
            // 当 browseType = 'byModule' 时，param 是模块ID
            // 当 browseType 是状态时，param 是 0
            let browseType;
            let param;
            if (moduleId) {
                // 按模块浏览
                browseType = 'byModule';
                param = moduleId;
            }
            else if (status && status !== 'all') {
                // 按状态浏览
                browseType = status;
                param = 0;
            }
            else {
                // 浏览全部
                browseType = 'all';
                param = 0;
            }
            const allCases = [];
            let currentPage = 1;
            const pageSize = 100;
            let hasMore = true;
            while (hasMore) {
                const url = `/testcase-browse-${productId}-0-${browseType}-${param}-id_desc-0-${pageSize}-${currentPage}.json`;
                const data = await this.request(url);
                const cases = data.cases || {};
                const casesArray = Object.values(cases);
                allCases.push(...casesArray);
                // 检查分页信息
                if (data.pager) {
                    const { recTotal, recPerPage, pageID } = data.pager;
                    const totalPages = Math.ceil(recTotal / recPerPage);
                    hasMore = currentPage < totalPages && casesArray.length > 0;
                }
                else {
                    hasMore = false;
                }
                currentPage++;
                // 安全限制：最多获取100页
                if (currentPage > 100) {
                    break;
                }
            }
            let mappedCases = allCases.map((testCase) => ({
                id: parseInt(testCase.id),
                product: parseInt(testCase.product),
                module: testCase.module ? parseInt(testCase.module) : undefined,
                story: testCase.story ? parseInt(testCase.story) : undefined,
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
        }
        catch (error) {
            console.error('获取测试用例列表失败:', error);
            throw error;
        }
    }
    /**
     * 获取测试用例详情
     */
    async getTestCaseDetail(caseId) {
        try {
            const data = await this.request(`/testcase-view-${caseId}.json`);
            const testCase = data.case;
            return {
                id: parseInt(testCase.id),
                product: parseInt(testCase.product),
                productName: data.product?.name,
                module: testCase.module ? parseInt(testCase.module) : undefined,
                moduleName: testCase.moduleName,
                story: testCase.story ? parseInt(testCase.story) : undefined,
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
            };
        }
        catch (error) {
            console.error('获取测试用例详情失败:', error);
            throw error;
        }
    }
    /**
     * 创建测试用例
     */
    async createTestCase(testCase) {
        try {
            const data = await this.postRequest(`/testcase-create-${testCase.product}.json`, {
                title: testCase.title,
                type: testCase.type || 'feature',
                pri: testCase.pri || 3,
                module: testCase.module || 0,
                story: testCase.story || 0,
                precondition: testCase.precondition || '',
                steps: testCase.steps || '',
                status: testCase.status || 'normal',
            });
            // 从响应中提取测试用例ID
            return data.id || 0;
        }
        catch (error) {
            console.error('创建测试用例失败:', error);
            throw error;
        }
    }
    /**
     * 获取需求的测试用例
     */
    async getStoryTestCases(storyId) {
        try {
            const data = await this.request(`/story-view-${storyId}.json`);
            const cases = data.cases || {};
            const casesArray = Object.values(cases);
            const mappedCases = casesArray.map((testCase) => ({
                id: parseInt(testCase.id),
                title: testCase.title,
                type: testCase.type,
                pri: parseInt(testCase.pri),
                status: testCase.status,
            }));
            return mappedCases;
        }
        catch (error) {
            console.error('获取需求测试用例失败:', error);
            return [];
        }
    }
    /**
     * 获取测试单列表
     */
    async getTestTasks(productId) {
        try {
            // 禅道11.x API路径：/testtask-browse-{productId}.json
            const url = productId ? `/testtask-browse-${productId}.json` : '/my-testtask.json';
            const data = await this.request(url);
            const tasks = data.tasks || {};
            const tasksArray = Object.values(tasks);
            const mappedTasks = tasksArray.map((task) => ({
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
        }
        catch (error) {
            console.error('获取测试单列表失败:', error);
            throw error;
        }
    }
    /**
     * 获取测试单详情
     */
    async getTestTaskDetail(taskId) {
        try {
            const data = await this.request(`/testtask-view-${taskId}.json`);
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
        }
        catch (error) {
            console.error('获取测试单详情失败:', error);
            throw error;
        }
    }
    /**
     * 获取测试单的测试结果
     */
    async getTestTaskResults(taskId) {
        try {
            const data = await this.request(`/testtask-cases-${taskId}.json`);
            const runs = data.runs || {};
            const runsArray = Object.values(runs);
            const mappedResults = runsArray.map((run) => ({
                id: parseInt(run.id),
                run: parseInt(run.task),
                case: parseInt(run.case),
                caseTitle: run.title,
                version: parseInt(run.version),
                status: run.caseStatus,
                lastRunner: run.lastRunner,
                lastRunDate: run.lastRunDate,
                lastRunResult: run.lastRunResult,
            }));
            return mappedResults;
        }
        catch (error) {
            console.error('获取测试结果失败:', error);
            return [];
        }
    }
    /**
     * 执行测试用例
     */
    async runTestCase(taskId, testRun) {
        try {
            await this.postRequest(`/testtask-runCase-${taskId}-${testRun.caseId}.json`, {
                version: testRun.version || 1,
                caseResult: testRun.result,
                steps: testRun.steps || '',
                comment: testRun.comment || '',
            });
        }
        catch (error) {
            console.error('执行测试用例失败:', error);
            throw error;
        }
    }
    /**
     * 获取需求关联的 Bug 列表
     */
    async getStoryRelatedBugs(storyId) {
        try {
            // 获取所有 Bug，然后过滤出关联到该需求的 Bug
            const allBugs = await this.getMyBugs();
            const relatedBugs = [];
            // 并行获取所有 Bug 的详情以检查关联关系
            const bugDetailsPromises = allBugs.map(bug => this.getBugDetail(bug.id).catch(() => null));
            const bugDetails = await Promise.all(bugDetailsPromises);
            for (const bugDetail of bugDetails) {
                if (bugDetail && bugDetail.story) {
                    const bugStoryId = typeof bugDetail.story === 'string'
                        ? parseInt(bugDetail.story)
                        : bugDetail.story;
                    if (bugStoryId === storyId) {
                        relatedBugs.push(bugDetail);
                    }
                }
            }
            return relatedBugs;
        }
        catch (error) {
            console.error(`获取需求 ${storyId} 关联的 Bug 失败:`, error);
            throw error;
        }
    }
    /**
     * 获取 Bug 关联的需求
     */
    async getBugRelatedStory(bugId) {
        try {
            const bug = await this.getBugDetail(bugId);
            if (!bug.story) {
                return null;
            }
            const storyId = typeof bug.story === 'string'
                ? parseInt(bug.story)
                : bug.story;
            return await this.getStoryDetail(storyId);
        }
        catch (error) {
            console.error(`获取 Bug ${bugId} 关联的需求失败:`, error);
            return null;
        }
    }
}
