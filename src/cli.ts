import { getConfigFilePath, loadConfig, loadFileConfig, saveConfig } from './config.js';
import { isSetupHost, runSetup, SETUP_HOSTS, SetupHost } from './setup.js';
import { ZentaoLegacyAPI } from './zentaoLegacyApi.js';
import { BugStatus, StoryStatus, TestCaseStatus } from './types.js';

interface ParsedArgs {
    positionals: string[];
    flags: Map<string, string | true>;
    json: boolean;
    help: boolean;
}

const HELP = `用法:
  zentao <命令> [参数] [--json]

在终端里直接运行会进入命令行。被 Cursor 等以管道启动、且不带参数时，仍然是 MCP 服务。
强制启动 MCP: zentao mcp

配置:
  config                                      查看当前配置（密码打码）
  config set --url URL --username USER --password PASS
                                              写入 ~/.zentao/config.json
                                              环境变量 ZENTAO_URL / ZENTAO_USERNAME / ZENTAO_PASSWORD 优先于文件
  setup [grok|claude|codex|cursor] [--dry-run]
                                              安装 skill，并登记 MCP。不写名字则四个都装

查询:
  ping                                        登录并确认能拉到产品
  products                                    产品列表
  product <id>                                产品详情
  modules --product <id>                      产品模块
  projects
  project <id>
  tasks [--project <id>] [--status wait|doing|done|all]
  task <id>
  bugs [--product <id>] [--module <id>] [--status active|resolved|closed|all]
  bug <id>
  stories [--product <id>] [--module <id>] [--status draft|active|closed|changed|all] [--limit N]
                                              不带产品时看指派给我的需求。带产品时默认只看激活需求
  story <id>
  search <关键字> [--product <id>] [--status ...] [--limit N]
                                              默认只在激活需求里搜，查全部加 --status all
  cases --product <id> [--module <id>] [--status normal|blocked|investigate|all]
  case <id>
  builds --project <id>
  testtasks [--product <id>]
  testtask <id>

修改:
  project create --name 名称 --code 代号 --begin YYYY-MM-DD --end YYYY-MM-DD --product <id> [--type sprint|waterfall|ops] [--desc 文本]
  project delete <id>                         不删除项目下的任务
  task create --project <id> --name 名称 [--type devel] [--assignedTo 账号] [--estimate N] [--story <id>] [--pri N]
  task start <id> [--consumed N] [--left N]
  task close <id> [--comment 文本]
  task assign <id> --assignedTo 账号 [--left N] [--comment 文本]
  task update <id> [--consumed N] [--left N] [--status wait|doing|done] [--comment 文本]
  task finish <id> [--consumed N] [--comment 文本]
  task delete <id>
  bug create --product <id> --title 标题 [--severity N] [--pri N] [--steps 文本] [--story <id>] [--build trunk] [--assignedTo 账号]
  bug resolve <id> --resolution fixed|notrepro|duplicate|bydesign|willnotfix|tostory|external [--build 版本] [--comment 文本]
  bug close <id> [--comment 文本]
  bug activate <id> [--assignedTo 账号] [--comment 文本]
  bug assign <id> --assignedTo 账号 [--comment 文本]
  bug delete <id>
  story create --product <id> --title 标题 [--spec 文本] [--pri N] [--estimate N]
  story change <id> [--title 标题] [--spec 文本] [--verify 文本] [--comment 文本]
  story close <id> --reason done|subdivided|duplicate|postponed|willnotdo|cancel|bydesign [--comment 文本]
  story activate <id> [--assignedTo 账号] [--comment 文本]
  story delete <id>
  build create --project <id> --product <id> --name 名称 [--builder 账号] [--date YYYY-MM-DD]
  build delete <id>
  testtask create --product <id> --project <id> --build <id> --name 名称 --begin YYYY-MM-DD --end YYYY-MM-DD [--owner 账号]
  testtask link <id> --case <id> [--version N]
  testtask delete <id>
  case delete <id>

全局参数:
  --json          输出原始 JSON
  --limit N       列表最多显示 N 条，默认 100。0 表示全部
  -h, --help
`;

/**
 * 无参数且 stdin 不是终端时保持 MCP。其余情况走命令行。
 */
export function shouldRunCli(argv: string[]): boolean {
    const args = argv.slice(2).filter(arg => arg !== '--json');
    if (args[0] === 'mcp' || args[0] === '--mcp') {
        return false;
    }
    if (args.length === 0 && !process.stdin.isTTY) {
        return false;
    }
    return true;
}

export async function runCli(argv: string[]): Promise<void> {
    try {
        await dispatch(parseArgs(argv));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    const positionals: string[] = [];
    const flags = new Map<string, string | true>();
    let json = false;
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (token === '--') {
            positionals.push(...args.slice(i + 1));
            break;
        }
        if (token === '--json') {
            json = true;
            continue;
        }
        if (token === '--help' || token === '-h') {
            help = true;
            continue;
        }
        if (token.startsWith('--')) {
            const eq = token.indexOf('=');
            if (eq !== -1) {
                flags.set(token.slice(2, eq), token.slice(eq + 1));
            } else {
                const key = token.slice(2);
                const next = args[i + 1];
                if (next === undefined || next.startsWith('-')) {
                    flags.set(key, true);
                } else {
                    flags.set(key, next);
                    i++;
                }
            }
            continue;
        }
        positionals.push(token);
    }

    return { positionals, flags, json, help };
}

async function dispatch(parsed: ParsedArgs): Promise<void> {
    if (parsed.help || parsed.positionals.length === 0 || parsed.positionals[0] === 'help') {
        console.log(HELP);
        return;
    }

    const [command, ...rest] = parsed.positionals;
    switch (command) {
        case 'config':
            await cmdConfig(rest, parsed.flags, parsed.json);
            return;
        case 'setup':
            await cmdSetup(rest, parsed.flags);
            return;
        case 'ping':
            await cmdPing(parsed.json);
            return;
        case 'products':
            await cmdProducts(parsed.json);
            return;
        case 'product':
            await cmdProduct(rest, parsed.json);
            return;
        case 'modules':
            await cmdModules(parsed.flags, parsed.json);
            return;
        case 'projects':
            await cmdProjects(parsed.json);
            return;
        case 'project':
            await cmdProject(rest, parsed.flags, parsed.json);
            return;
        case 'tasks':
            await cmdTasks(parsed.flags, parsed.json);
            return;
        case 'task':
            await cmdTask(rest, parsed.flags, parsed.json);
            return;
        case 'bugs':
            await cmdBugs(parsed.flags, parsed.json);
            return;
        case 'bug':
            await cmdBug(rest, parsed.flags, parsed.json);
            return;
        case 'stories':
            await cmdStories(parsed.flags, parsed.json);
            return;
        case 'story':
            await cmdStory(rest, parsed.flags, parsed.json);
            return;
        case 'search':
            await cmdSearch(rest, parsed.flags, parsed.json);
            return;
        case 'cases':
            await cmdCases(parsed.flags, parsed.json);
            return;
        case 'case':
            await cmdCase(rest, parsed.json);
            return;
        case 'builds':
            await cmdBuilds(parsed.flags, parsed.json);
            return;
        case 'build':
            await cmdBuild(rest, parsed.flags, parsed.json);
            return;
        case 'testtasks':
            await cmdTestTasks(parsed.flags, parsed.json);
            return;
        case 'testtask':
            await cmdTestTask(rest, parsed.flags, parsed.json);
            return;
        default:
            throw new Error(`未知命令: ${command}\n\n${HELP}`);
    }
}

async function api(): Promise<ZentaoLegacyAPI> {
    const config = loadConfig();
    if (!config) {
        throw new Error(
            '未找到禅道配置。请设置环境变量 ZENTAO_URL、ZENTAO_USERNAME、ZENTAO_PASSWORD，或运行 config set。'
        );
    }
    return new ZentaoLegacyAPI(config);
}

function envOverridesFile(): boolean {
    return Boolean(process.env.ZENTAO_URL && process.env.ZENTAO_USERNAME && process.env.ZENTAO_PASSWORD);
}

async function cmdConfig(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    if (rest[0] === 'set') {
        const existing = loadFileConfig();
        const url = flagString(flags, 'url') || existing?.url;
        const username = flagString(flags, 'username') || existing?.username;
        const password = flagString(flags, 'password') || existing?.password;
        if (!url || !username || !password) {
            throw new Error('config set 需要 --url、--username、--password。已有配置文件时可以只改其中几项。');
        }
        saveConfig({ url, username, password, apiVersion: 'legacy' });
        const saved = {
            path: getConfigFilePath(),
            url,
            username,
            password: '***',
            apiVersion: 'legacy' as const
        };
        emit(json, saved, () => {
            console.log(`已写入 ${saved.path}`);
            console.log(`url: ${url}`);
            console.log(`username: ${username}`);
            console.log('password: ***');
            if (envOverridesFile()) {
                console.log('当前进程有 ZENTAO_* 环境变量，实际请求会使用环境变量，而不是这个文件。');
            }
        });
        return;
    }

    if (rest.length > 0) {
        throw new Error('config 只支持查看，或 config set。');
    }

    const config = loadConfig();
    if (!config) {
        throw new Error(`未找到配置。文件路径: ${getConfigFilePath()}`);
    }
    const view = {
        source: envOverridesFile() ? 'env' : 'file',
        path: getConfigFilePath(),
        url: config.url,
        username: config.username,
        password: '***',
        apiVersion: config.apiVersion
    };
    emit(json, view, () => {
        console.log(`来源: ${view.source === 'env' ? '环境变量' : view.path}`);
        console.log(`url: ${view.url}`);
        console.log(`username: ${view.username}`);
        console.log('password: ***');
        console.log(`apiVersion: ${view.apiVersion}`);
    });
}

async function cmdSetup(rest: string[], flags: Map<string, string | true>): Promise<void> {
    const unknown = rest.filter(item => !isSetupHost(item));
    if (unknown.length > 0) {
        throw new Error(`setup 不认识: ${unknown.join(', ')}。可选 ${SETUP_HOSTS.join('、')}`);
    }
    const hosts: SetupHost[] = rest.length > 0 ? rest.filter(isSetupHost) : [...SETUP_HOSTS];
    const ok = runSetup({ hosts, dryRun: flags.get('dry-run') === true });
    if (!ok) {
        process.exitCode = 1;
    }
}

async function cmdPing(json: boolean): Promise<void> {
    const client = await api();
    const products = await client.getProducts();
    const result = { ok: true, products: products.length };
    emit(json, result, () => {
        console.log(`连接成功，共 ${products.length} 个产品。`);
    });
}

async function cmdProducts(json: boolean): Promise<void> {
    const products = await (await api()).getProducts();
    const rows = products.map(product => ({
        id: product.id,
        code: product.code,
        status: product.status,
        name: product.name
    }));
    emit(json, rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 6 },
            { key: 'code', title: '编号', width: 16 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'name', title: '名称', width: 32 }
        ]);
        console.log(`共 ${rows.length} 个产品`);
    });
}

async function cmdProduct(rest: string[], json: boolean): Promise<void> {
    const productId = requireId(rest[0], 'product <id>');
    const products = await (await api()).getProducts();
    const product = products.find(item => item.id === productId);
    if (!product) {
        throw new Error(`未找到产品 ${productId}`);
    }
    emit(json, product, () => printRecord(product as unknown as Record<string, unknown>, ['desc']));
}

async function cmdModules(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const productId = requireNumber(flags, 'product');
    const modules = await (await api()).getProductModules(productId);
    const rows = Object.entries(modules).map(([id, name]) => ({ id, name }));
    emit(json, rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'name', title: '名称', width: 48 }
        ]);
        console.log(`共 ${rows.length} 个模块`);
    });
}

async function cmdProjects(json: boolean): Promise<void> {
    const projects = await (await api()).getProjects();
    emit(json, projects, () => {
        printTable(projects.map(project => ({
            id: project.id,
            status: project.status,
            code: project.code,
            name: project.name
        })), [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'code', title: '代号', width: 16 },
            { key: 'name', title: '名称', width: 36 }
        ]);
        console.log(`共 ${projects.length} 个项目`);
    });
}

async function cmdProject(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();
    if (rest[0] === 'create') {
        const project = await client.createProject({
            name: requireString(flags, 'name'),
            code: requireString(flags, 'code'),
            begin: requireString(flags, 'begin'),
            end: requireString(flags, 'end'),
            products: [requireNumber(flags, 'product')],
            type: optionalEnum(flags, 'type', ['sprint', 'waterfall', 'ops'] as const),
            desc: flagString(flags, 'desc')
        });
        emit(json, project, () => printRecord(project as unknown as Record<string, unknown>, ['desc']));
        return;
    }
    if (rest[0] === 'delete') {
        const projectId = requireId(rest[1], 'project delete <id>');
        await client.deleteProject(projectId);
        emit(json, { ok: true, projectId }, () => console.log(`项目 ${projectId} 已删除。项目下的任务不会一起删除。`));
        return;
    }
    const projectId = requireId(rest[0], 'project <id>');
    const project = await client.getProject(projectId);
    emit(json, project, () => printRecord(project as unknown as Record<string, unknown>, ['desc']));
}

async function cmdTasks(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const status = optionalEnum(flags, 'status', ['wait', 'doing', 'done', 'all'] as const);
    const projectId = optionalNumber(flags, 'project');
    const client = await api();
    let tasks = projectId ? await client.getProjectTasks(projectId) : await client.getMyTasks();
    if (status && status !== 'all') {
        tasks = tasks.filter(task => task.status === status);
    }
    const { shown, total, limited } = applyLimit(tasks, flags);
    const rows = shown.map(task => ({
        id: task.id,
        pri: task.pri,
        status: task.status,
        deadline: task.deadline || '',
        name: task.name
    }));
    emit(json, limited ? { total, items: rows } : rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'pri', title: '优先级', width: 8 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'deadline', title: '截止', width: 12 },
            { key: 'name', title: '名称', width: 40 }
        ]);
        printLimitFooter(shown.length, total, limited);
    });
}

async function cmdTask(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();

    if (rest[0] === 'create') {
        const task = await client.createTask({
            project: requireNumber(flags, 'project'),
            name: requireString(flags, 'name'),
            type: flagString(flags, 'type'),
            assignedTo: flagString(flags, 'assignedTo'),
            estimate: optionalDecimal(flags, 'estimate'),
            pri: optionalNumber(flags, 'pri'),
            desc: flagString(flags, 'desc'),
            story: optionalNumber(flags, 'story')
        });
        emit(json, task, () => printRecord(task as unknown as Record<string, unknown>, ['desc']));
        return;
    }
    if (rest[0] === 'start') {
        const taskId = requireId(rest[1], 'task start <id>');
        const task = await client.startTask(taskId, {
            consumed: optionalDecimal(flags, 'consumed'),
            left: optionalDecimal(flags, 'left')
        });
        emit(json, task, () => printRecord(task as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'close') {
        const taskId = requireId(rest[1], 'task close <id>');
        const task = await client.closeTask(taskId, flagString(flags, 'comment'));
        emit(json, task, () => printRecord(task as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'assign') {
        const taskId = requireId(rest[1], 'task assign <id>');
        const task = await client.assignTask(taskId, requireString(flags, 'assignedTo'), {
            left: optionalDecimal(flags, 'left'),
            comment: flagString(flags, 'comment')
        });
        emit(json, task, () => printRecord(task as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'delete') {
        const taskId = requireId(rest[1], 'task delete <id>');
        await client.deleteTask(taskId);
        emit(json, { ok: true, taskId }, () => console.log(`任务 ${taskId} 已删除。`));
        return;
    }

    if (rest[0] === 'update' || rest[0] === 'finish') {
        const action = rest[0];
        const taskId = requireId(rest[1], `task ${action} <id>`);
        if (action === 'update') {
            const status = optionalEnum(flags, 'status', ['wait', 'doing', 'done'] as const);
            const consumed = optionalDecimal(flags, 'consumed');
            const left = optionalDecimal(flags, 'left');
            const comment = flagString(flags, 'comment');
            if (consumed === undefined && left === undefined && !status && !comment) {
                throw new Error('task update 至少指定 --consumed、--left、--status 或 --comment');
            }
            const task = await client.updateTask(taskId, { consumed, left, status, comment });
            emit(json, task, () => printRecord(task as unknown as Record<string, unknown>));
            return;
        }
        await client.finishTask(taskId, {
            consumed: optionalDecimal(flags, 'consumed'),
            comment: flagString(flags, 'comment')
        });
        const result = { ok: true, taskId, action: 'finish' };
        emit(json, result, () => console.log(`任务 ${taskId} 已完成。`));
        return;
    }

    const taskId = requireId(rest[0], 'task <id>');
    const task = await client.getTaskDetail(taskId);
    emit(json, task, () => printRecord(task as unknown as Record<string, unknown>, ['desc']));
}

async function cmdBugs(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const status = optionalEnum(flags, 'status', ['active', 'resolved', 'closed', 'all'] as const) as BugStatus | undefined;
    const productId = optionalNumber(flags, 'product');
    const moduleId = optionalNumber(flags, 'module');
    if (moduleId && !productId) {
        throw new Error('--module 需要同时指定 --product');
    }
    const client = await api();
    let bugs = productId
        ? await client.getProductBugs(productId, status, moduleId)
        : await client.getMyBugs();
    if (!productId && status && status !== 'all') {
        bugs = bugs.filter(bug => bug.status === status);
    }
    const { shown, total, limited } = applyLimit(bugs, flags);
    const rows = shown.map(bug => ({
        id: bug.id,
        severity: bug.severity,
        status: bug.status,
        title: bug.title
    }));
    emit(json, limited ? { total, items: rows } : rows, () => {
        if (!productId && total === 0) {
            console.log('当前账号名下没有 Bug。查看某个产品：bugs --product <产品ID>');
            return;
        }
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'severity', title: '严重', width: 6 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'title', title: '标题', width: 48 }
        ]);
        printLimitFooter(shown.length, total, limited);
    });
}

async function cmdBug(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();

    if (rest[0] === 'create') {
        const bug = await client.createBug({
            product: requireNumber(flags, 'product'),
            title: requireString(flags, 'title'),
            severity: optionalNumber(flags, 'severity'),
            pri: optionalNumber(flags, 'pri'),
            steps: flagString(flags, 'steps'),
            story: optionalNumber(flags, 'story'),
            openedBuild: flagString(flags, 'build'),
            assignedTo: flagString(flags, 'assignedTo'),
            type: flagString(flags, 'type')
        });
        emit(json, bug, () => printRecord({ ...bug, steps: textOf(bug.steps) }, ['steps']));
        return;
    }
    if (rest[0] === 'resolve') {
        const bugId = requireId(rest[1], 'bug resolve <id>');
        const resolution = requireEnum(flags, 'resolution', ['fixed', 'notrepro', 'duplicate', 'bydesign', 'willnotfix', 'tostory', 'external'] as const);
        await client.resolveBug(bugId, {
            resolution,
            resolvedBuild: flagString(flags, 'build'),
            comment: flagString(flags, 'comment')
        });
        const result = { ok: true, bugId, resolution };
        emit(json, result, () => console.log(`Bug ${bugId} 已标记为 ${resolution}。`));
        return;
    }
    if (rest[0] === 'close') {
        const bugId = requireId(rest[1], 'bug close <id>');
        const bug = await client.closeBug(bugId, flagString(flags, 'comment'));
        emit(json, bug, () => printRecord(bug as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'activate') {
        const bugId = requireId(rest[1], 'bug activate <id>');
        const bug = await client.activateBug(bugId, {
            assignedTo: flagString(flags, 'assignedTo'),
            comment: flagString(flags, 'comment')
        });
        emit(json, bug, () => printRecord(bug as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'assign') {
        const bugId = requireId(rest[1], 'bug assign <id>');
        const bug = await client.assignBug(bugId, requireString(flags, 'assignedTo'), flagString(flags, 'comment'));
        emit(json, bug, () => printRecord(bug as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'delete') {
        const bugId = requireId(rest[1], 'bug delete <id>');
        await client.deleteBug(bugId);
        emit(json, { ok: true, bugId }, () => console.log(`Bug ${bugId} 已删除。`));
        return;
    }

    const bugId = requireId(rest[0], 'bug <id>');
    const bug = await client.getBugDetail(bugId);
    emit(json, bug, () => printRecord({ ...bug, steps: textOf(bug.steps) }, ['steps']));
}

async function cmdStories(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const productId = optionalNumber(flags, 'product');
    const status = optionalEnum(flags, 'status', ['draft', 'active', 'closed', 'changed', 'all'] as const) as StoryStatus | undefined;
    const moduleId = optionalNumber(flags, 'module');
    if (moduleId && !productId) {
        throw new Error('--module 需要同时指定 --product');
    }
    const client = await api();
    const stories = productId
        ? await client.getProductStories(productId, status, moduleId)
        : (await client.getMyStories()).filter(story => !status || status === 'all' || story.status === status);
    const { shown, total, limited } = applyLimit(stories, flags);
    const rows = shown.map(story => ({
        id: story.id,
        pri: story.pri,
        status: story.status,
        stage: story.stage || '',
        title: story.title
    }));
    emit(json, limited ? { total, items: rows } : rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'pri', title: '优先级', width: 8 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'stage', title: '阶段', width: 12 },
            { key: 'title', title: '标题', width: 40 }
        ]);
        printLimitFooter(shown.length, total, limited);
    });
}

async function cmdStory(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();
    if (rest[0] === 'create') {
        const story = await client.createStory({
            product: requireNumber(flags, 'product'),
            title: requireString(flags, 'title'),
            spec: flagString(flags, 'spec'),
            pri: optionalNumber(flags, 'pri'),
            estimate: optionalDecimal(flags, 'estimate')
        });
        emit(json, story, () => printRecord({ ...story, spec: textOf(story.spec) }, ['spec']));
        return;
    }
    if (rest[0] === 'change') {
        const storyId = requireId(rest[1], 'story change <id>');
        const title = flagString(flags, 'title');
        const spec = flagString(flags, 'spec');
        const verify = flagString(flags, 'verify');
        const comment = flagString(flags, 'comment');
        if (!title && !spec && !verify && !comment) {
            throw new Error('story change 至少指定 --title、--spec、--verify 或 --comment');
        }
        const story = await client.changeStory(storyId, { title, spec, verify, comment });
        emit(json, story, () => printRecord({ ...story, spec: textOf(story.spec) }, ['spec']));
        return;
    }
    if (rest[0] === 'close') {
        const storyId = requireId(rest[1], 'story close <id>');
        const reason = requireEnum(flags, 'reason', ['done', 'subdivided', 'duplicate', 'postponed', 'willnotdo', 'cancel', 'bydesign'] as const);
        const story = await client.closeStory(storyId, reason, flagString(flags, 'comment'));
        emit(json, story, () => printRecord(story as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'activate') {
        const storyId = requireId(rest[1], 'story activate <id>');
        const story = await client.activateStory(storyId, {
            assignedTo: flagString(flags, 'assignedTo'),
            comment: flagString(flags, 'comment')
        });
        emit(json, story, () => printRecord(story as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'delete') {
        const storyId = requireId(rest[1], 'story delete <id>');
        await client.deleteStory(storyId);
        emit(json, { ok: true, storyId }, () => console.log(`需求 ${storyId} 已删除。`));
        return;
    }
    const storyId = requireId(rest[0], 'story <id>');
    const story = await client.getStoryDetail(storyId);
    emit(json, story, () => printRecord({ ...story, spec: textOf(story.spec) }, ['spec']));
}

async function cmdSearch(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const keyword = rest.join(' ').trim();
    if (!keyword) {
        throw new Error('search 需要关键字。');
    }
    const productId = optionalNumber(flags, 'product');
    const status = optionalEnum(flags, 'status', ['draft', 'active', 'closed', 'changed', 'all'] as const) as StoryStatus | undefined;
    const limitFlag = flags.get('limit');
    const limit = limitFlag === undefined ? 50 : requireNonNegative(limitFlag, '--limit');
    if (!productId) {
        console.error('未指定 --product，会遍历全部产品后再本地过滤，可能比较慢。');
    }
    const stories = await (await api()).searchStories(keyword, {
        productId,
        status,
        limit: limit === 0 ? 100000 : limit
    });
    const rows = stories.map(story => ({
        id: story.id,
        status: story.status,
        title: story.title
    }));
    emit(json, rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'status', title: '状态', width: 10 },
            { key: 'title', title: '标题', width: 48 }
        ]);
        console.log(`共 ${rows.length} 条`);
    });
}

async function cmdCases(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const productId = requireNumber(flags, 'product');
    const status = optionalEnum(flags, 'status', ['normal', 'blocked', 'investigate', 'all'] as const) as TestCaseStatus | undefined;
    const moduleId = optionalNumber(flags, 'module');
    const cases = await (await api()).getProductTestCases(productId, status, moduleId);
    const { shown, total, limited } = applyLimit(cases, flags);
    const rows = shown.map(item => ({
        id: item.id,
        pri: item.pri,
        status: item.status,
        title: item.title
    }));
    emit(json, limited ? { total, items: rows } : rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'pri', title: '优先级', width: 8 },
            { key: 'status', title: '状态', width: 12 },
            { key: 'title', title: '标题', width: 48 }
        ]);
        printLimitFooter(shown.length, total, limited);
    });
}

async function cmdCase(rest: string[], json: boolean): Promise<void> {
    if (rest[0] === 'delete') {
        const caseId = requireId(rest[1], 'case delete <id>');
        await (await api()).deleteTestCase(caseId);
        emit(json, { ok: true, caseId }, () => console.log(`用例 ${caseId} 已删除。`));
        return;
    }
    const caseId = requireId(rest[0], 'case <id>');
    const testCase = await (await api()).getTestCaseDetail(caseId);
    emit(json, testCase, () => printRecord({
        ...testCase,
        precondition: textOf(testCase.precondition),
        steps: textOf(testCase.steps)
    }, ['precondition', 'steps']));
}

async function cmdTestTasks(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const productId = optionalNumber(flags, 'product');
    const tasks = await (await api()).getTestTasks(productId);
    const { shown, total, limited } = applyLimit(tasks, flags);
    const rows = shown.map(task => ({
        id: task.id,
        status: task.status,
        name: task.name
    }));
    emit(json, limited ? { total, items: rows } : rows, () => {
        printTable(rows, [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'status', title: '状态', width: 12 },
            { key: 'name', title: '名称', width: 48 }
        ]);
        printLimitFooter(shown.length, total, limited);
    });
}

async function cmdBuilds(flags: Map<string, string | true>, json: boolean): Promise<void> {
    const projectId = requireNumber(flags, 'project');
    const builds = await (await api()).getProjectBuilds(projectId);
    emit(json, builds, () => {
        printTable(builds.map(build => ({
            id: build.id,
            date: build.date || '',
            name: build.name
        })), [
            { key: 'id', title: 'ID', width: 8 },
            { key: 'date', title: '日期', width: 12 },
            { key: 'name', title: '名称', width: 40 }
        ]);
        console.log(`共 ${builds.length} 个版本`);
    });
}

async function cmdBuild(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();
    if (rest[0] === 'create') {
        const build = await client.createBuild({
            project: requireNumber(flags, 'project'),
            product: requireNumber(flags, 'product'),
            name: requireString(flags, 'name'),
            builder: flagString(flags, 'builder'),
            date: flagString(flags, 'date'),
            desc: flagString(flags, 'desc')
        });
        emit(json, build, () => printRecord(build as unknown as Record<string, unknown>));
        return;
    }
    if (rest[0] === 'delete') {
        const buildId = requireId(rest[1], 'build delete <id>');
        await client.deleteBuild(buildId);
        emit(json, { ok: true, buildId }, () => console.log(`版本 ${buildId} 已删除。`));
        return;
    }
    throw new Error('用法: build create 或 build delete <id>');
}

async function cmdTestTask(rest: string[], flags: Map<string, string | true>, json: boolean): Promise<void> {
    const client = await api();
    if (rest[0] === 'create') {
        const task = await client.createTestTask({
            product: requireNumber(flags, 'product'),
            project: requireNumber(flags, 'project'),
            build: requireNumber(flags, 'build'),
            name: requireString(flags, 'name'),
            begin: requireString(flags, 'begin'),
            end: requireString(flags, 'end'),
            owner: flagString(flags, 'owner'),
            desc: flagString(flags, 'desc')
        });
        emit(json, task, () => printRecord({ ...task, desc: textOf(task.desc) }, ['desc']));
        return;
    }
    if (rest[0] === 'link') {
        const taskId = requireId(rest[1], 'testtask link <id>');
        const caseId = requireNumber(flags, 'case');
        await client.linkTestCase(taskId, caseId, optionalNumber(flags, 'version'));
        emit(json, { ok: true, taskId, caseId }, () => console.log(`用例 ${caseId} 已关联到测试单 ${taskId}。`));
        return;
    }
    if (rest[0] === 'delete') {
        const taskId = requireId(rest[1], 'testtask delete <id>');
        await client.deleteTestTask(taskId);
        emit(json, { ok: true, taskId }, () => console.log(`测试单 ${taskId} 已删除。`));
        return;
    }
    const taskId = requireId(rest[0], 'testtask <id>');
    const task = await client.getTestTaskDetail(taskId);
    emit(json, task, () => printRecord({ ...task, desc: textOf(task.desc) }, ['desc']));
}

function emit(json: boolean, data: unknown, plain: () => void): void {
    if (json) {
        console.log(JSON.stringify(data, null, 2));
        return;
    }
    plain();
}

function applyLimit<T>(items: T[], flags: Map<string, string | true>): { shown: T[]; total: number; limited: boolean } {
    const total = items.length;
    const raw = flags.get('limit');
    const limit = raw === undefined ? 100 : requireNonNegative(raw, '--limit');
    if (limit === 0 || limit >= total) {
        return { shown: items, total, limited: false };
    }
    return { shown: items.slice(0, limit), total, limited: true };
}

function printLimitFooter(shown: number, total: number, limited: boolean): void {
    if (limited) {
        console.log(`显示 ${shown} / ${total} 条。查看全部请加 --limit 0`);
        return;
    }
    console.log(`共 ${total} 条`);
}

function printTable(rows: Record<string, unknown>[], columns: { key: string; title: string; width: number }[]): void {
    if (rows.length === 0) {
        console.log('没有数据');
        return;
    }
    const header = columns.map(column => pad(column.title, column.width)).join('  ');
    console.log(header);
    console.log(columns.map(column => '-'.repeat(Math.min(column.width, Math.max(3, displayWidth(column.title))))).join('  '));
    for (const row of rows) {
        console.log(columns.map(column => pad(clip(String(row[column.key] ?? ''), column.width), column.width)).join('  '));
    }
}

function printRecord(record: Record<string, unknown>, longFields: string[] = []): void {
    const long = new Set(longFields);
    for (const [key, value] of Object.entries(record)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        if (long.has(key)) {
            continue;
        }
        console.log(`${key}: ${value}`);
    }
    for (const key of longFields) {
        const value = record[key];
        if (value === undefined || value === null || value === '') {
            continue;
        }
        console.log('');
        console.log(`${key}:`);
        console.log(String(value));
    }
}

function textOf(html?: string): string {
    if (!html) {
        return '';
    }
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function flagString(flags: Map<string, string | true>, name: string): string | undefined {
    const value = flags.get(name);
    if (value === undefined || value === true) {
        return undefined;
    }
    return value;
}

function optionalNumber(flags: Map<string, string | true>, name: string): number | undefined {
    const value = flags.get(name);
    if (value === undefined) {
        return undefined;
    }
    return requireNonNegative(value, `--${name}`);
}

function optionalDecimal(flags: Map<string, string | true>, name: string): number | undefined {
    const value = flags.get(name);
    if (value === undefined) {
        return undefined;
    }
    if (value === true || !/^\d+(\.\d+)?$/.test(value)) {
        throw new Error(`--${name} 必须是数字`);
    }
    return Number(value);
}

function requireString(flags: Map<string, string | true>, name: string): string {
    const value = flagString(flags, name);
    if (!value) {
        throw new Error(`缺少 --${name}`);
    }
    return value;
}

function requireNumber(flags: Map<string, string | true>, name: string): number {
    const value = flags.get(name);
    if (value === undefined || value === true || !/^\d+$/.test(value)) {
        throw new Error(`缺少或无效的 --${name}`);
    }
    return parseInt(value, 10);
}

function requireNonNegative(value: string | true, label: string): number {
    if (value === true || !/^\d+$/.test(value)) {
        throw new Error(`${label} 必须是非负整数`);
    }
    return parseInt(value, 10);
}

function requireId(raw: string | undefined, usage: string): number {
    if (!raw || !/^\d+$/.test(raw)) {
        throw new Error(`用法: ${usage}`);
    }
    return parseInt(raw, 10);
}

function optionalEnum<T extends string>(flags: Map<string, string | true>, name: string, allowed: readonly T[]): T | undefined {
    const value = flags.get(name);
    if (value === undefined) {
        return undefined;
    }
    if (value === true || !allowed.includes(value as T)) {
        throw new Error(`--${name} 只能是 ${allowed.join('|')}`);
    }
    return value as T;
}

function requireEnum<T extends string>(flags: Map<string, string | true>, name: string, allowed: readonly T[]): T {
    const value = optionalEnum(flags, name, allowed);
    if (!value) {
        throw new Error(`缺少 --${name}，可选 ${allowed.join('|')}`);
    }
    return value;
}

function charWidth(ch: string): number {
    const code = ch.codePointAt(0) ?? 0;
    if (
        (code >= 0x1100 && code <= 0x115f) ||
        code === 0x2329 || code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)
    ) {
        return 2;
    }
    return 1;
}

function displayWidth(text: string): number {
    let width = 0;
    for (const ch of text) {
        width += charWidth(ch);
    }
    return width;
}

function clip(text: string, max: number): string {
    let width = 0;
    let out = '';
    for (const ch of text.replace(/\s+/g, ' ')) {
        const w = charWidth(ch);
        if (width + w > max) {
            return out + '…';
        }
        out += ch;
        width += w;
    }
    return out;
}

function pad(text: string, width: number): string {
    const gap = width - displayWidth(text);
    return gap > 0 ? text + ' '.repeat(gap) : text;
}
