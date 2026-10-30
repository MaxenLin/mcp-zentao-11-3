# @maxenlin/mcp-zentao-11-3

禅道 11.3 Legacy 版 MCP 服务器，同时提供 `zentao` 命令行。支持 Cursor、Claude、Grok、Codex 等工具，只支持旧版 Session API。

## ✨ 特性

- ✅ **纯 Legacy API** - 只支持禅道 11.x 版本的 Session API
- ✅ **命令行和 MCP** - 全局安装后用 `zentao` 查询和修改；同一个程序也是 MCP 服务
- ✅ **读写** - 产品、项目、需求、任务、Bug、用例、版本、测试单
- ✅ **AI 编程优化** - 提供完整开发上下文、格式化输出、智能摘要等功能
- ✅ **开箱即用** - `zentao config set` 写配置，`zentao setup` 安装 skill 并登记 MCP

## 📋 系统要求

- **Node.js**: >= 18.0.0（推荐使用 LTS 版本）

## ⚠️ 故障排除

### Windows 系统：`node` 命令未找到

如果遇到错误 `'node' 不是内部或外部命令` 或 `command spawn node ENOENT`，说明系统找不到 Node.js。

#### 解决方案 1：安装 Node.js 并添加到 PATH（推荐）

1. **下载并安装 Node.js**
   - 访问 [Node.js 官网](https://nodejs.org/) 下载 LTS 版本
   - 运行安装程序，**确保勾选 "Add to PATH" 选项**

2. **验证安装**
   ```powershell
   node --version
   npm --version
   ```

3. **如果已安装但未在 PATH 中**
   - 找到 Node.js 安装路径（通常在 `C:\Program Files\nodejs\` 或 `C:\Users\你的用户名\AppData\Local\Programs\nodejs\`）
   - 将 Node.js 安装目录添加到系统 PATH 环境变量
   - 重启 Cursor IDE

#### 解决方案 2：使用完整路径（推荐方案）

如果 Node.js 已安装但 Cursor 无法读取 PATH，可以在配置中使用完整路径：

**使用 nvm-windows 安装的 Node.js：**
```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "C:\\nvm4w\\nodejs\\node.exe",
      "args": ["D:/develop/code/mcp-zentao/mcp-zentao-11.3/dist/index.js"],
      "env": {
        "ZENTAO_URL": "http://your-zentao-url/zentao",
        "ZENTAO_USERNAME": "your-username",
        "ZENTAO_PASSWORD": "your-password"
      }
    }
  }
}
```

**使用标准安装的 Node.js：**
```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:/develop/code/mcp-zentao/mcp-zentao-11.3/dist/index.js"],
      "env": {
        "ZENTAO_URL": "http://your-zentao-url/zentao",
        "ZENTAO_USERNAME": "your-username",
        "ZENTAO_PASSWORD": "your-password"
      }
    }
  }
}
```

> **注意**：
> - 将路径中的 Node.js 路径替换为您的实际安装路径
> - 将 `D:/develop/code/mcp-zentao/mcp-zentao-11.3/dist/index.js` 替换为实际的包安装路径或项目路径

#### 解决方案 3：使用本地开发版本

如果您在本地开发此项目，可以直接使用项目路径：

```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:/develop/code/mcp-zentao/mcp-zentao-11.3/dist/index.js"],
      "env": {
        "ZENTAO_URL": "http://your-zentao-url/zentao",
        "ZENTAO_USERNAME": "your-username",
        "ZENTAO_PASSWORD": "your-password"
      }
    }
  }
}
```

> **提示**：配置修改后需要重启 Cursor IDE 才能生效。

## 📦 安装

需要 Node.js 18 或更高版本。

### 方法 1：全局安装

```bash
npm install -g @maxenlin/mcp-zentao-11-3
zentao --help
```

安装后可以直接用 `zentao`。`mcp-zentao-11-3` 是同一个程序。

然后在支持 MCP 的 IDE/工具配置文件中添加（以 Cursor IDE 为例）：

```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "zentao",
      "args": [],
      "env": {
        "ZENTAO_URL": "http://your-zentao-url/zentao",
        "ZENTAO_USERNAME": "your-username",
        "ZENTAO_PASSWORD": "your-password"
      }
    }
  }
}
```

**配置说明：**
- `ZENTAO_URL`: 禅道服务器地址（必须包含 `/zentao` 路径）
- `ZENTAO_USERNAME`: 禅道用户名
- `ZENTAO_PASSWORD`: 禅道密码

终端里找不到 `zentao` 时，把 `npm config get prefix` 打印出来的目录下的 `bin` 加进 PATH。Windows 上 npm 会同时生成 `zentao.cmd`。

> **提示**：工作空间路径会自动检测，批量导出功能会将文件保存到当前项目工作空间的 `export/` 目录。

### 方法 2：使用 npx

包里有 `zentao` 和 `mcp-zentao-11-3` 两个命令，npx 必须写明要跑哪一个。

```bash
npx --package @maxenlin/mcp-zentao-11-3 zentao --help
```

在支持 MCP 的 IDE/工具配置文件中添加（以 Cursor IDE 为例）：

```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "npx",
      "args": ["-y", "--package", "@maxenlin/mcp-zentao-11-3", "zentao"],
      "env": {
        "ZENTAO_URL": "http://your-zentao-url/zentao",
        "ZENTAO_USERNAME": "your-username",
        "ZENTAO_PASSWORD": "your-password"
      }
    }
  }
}
```

**配置说明：**
- `ZENTAO_URL`: 禅道服务器地址（必须包含 `/zentao` 路径）
- `ZENTAO_USERNAME`: 禅道用户名
- `ZENTAO_PASSWORD`: 禅道密码

> **提示**：工作空间路径会自动检测，批量导出功能会将文件保存到当前项目工作空间的 `export/` 目录。

## 命令行

全局安装之后，在终端里直接运行 `zentao`。不带参数会显示帮助。Cursor 等客户端不带参数、并用管道启动时，仍然是 MCP 服务。

```bash
# 写入 ~/.zentao/config.json（权限 600）
zentao config set \
  --url http://your-zentao-url/zentao \
  --username your-username \
  --password your-password

# 环境变量优先于配置文件
export ZENTAO_URL=http://your-zentao-url/zentao
export ZENTAO_USERNAME=your-username
export ZENTAO_PASSWORD=your-password

zentao ping
zentao products
zentao stories
zentao stories --product 230
zentao story 2508
zentao bug 20692
zentao search 接福 --product 230 --status all

zentao project create --name 迭代一 --code sprint1 --begin 2026-10-28 --end 2026-11-04 --product 1
zentao task create --project 1 --name 实现登录
zentao bug create --product 1 --title 登录失败
zentao story create --product 1 --title 支持扫码登录
```

加 `--json` 输出原始 JSON。`--limit 0` 表示列表不截断，默认最多显示 100 条。

项目、任务、Bug、需求、版本、测试单都可以在命令行里创建和删除。`project delete` 不会删掉项目下的任务。完整子命令见 `zentao --help`。

需求列表和搜索默认只包含激活需求。要查全部状态，加上 `--status all`。

本机改源码时用 `npm install && npm run build && npm link`，改完再 `npm run build`。这只给开发用，别人不需要。

## Skill 和插件

全局安装之后，一条命令给 Grok Build、Claude Code、Codex、Cursor 装上同一份 skill，并登记 MCP。skill 告诉助手用 `zentao` 命令；MCP 仍是这个程序的 `zentao mcp`。

```bash
zentao config set --url http://your-zentao-url/zentao --username your-username --password your-password
zentao setup
zentao setup claude codex
zentao setup --dry-run
```

| 工具 | skill | MCP |
|---|---|---|
| Grok Build | `~/.grok/skills/zentao/SKILL.md` | `grok mcp add --scope user zentao -- zentao mcp` |
| Claude Code | `~/.claude/skills/zentao/SKILL.md` | `claude mcp add --scope user zentao -- zentao mcp` |
| Codex | `~/.agents/skills/zentao/SKILL.md` | `codex mcp add zentao -- zentao mcp` |
| Cursor | `~/.cursor/skills/zentao/SKILL.md` | `~/.cursor/mcp.json` |

装好后重新打开对应工具。Grok 里是 `/zentao`，Claude Code 里是 `/zentao`，Codex 里用 `$zentao`。

也可以把仓库里的 `plugin/` 当插件装。它带同一份 skill 和 `.mcp.json`，Grok 与 Claude Code 都能读：

```bash
grok plugin install /path/to/mcp-zentao-11-3/plugin --trust
```

全局安装后的插件目录在 `npm root -g` 下面的 `@maxenlin/mcp-zentao-11-3/plugin`。`zentao setup` 和插件安装二选一，否则 skill 会装两份。

## 🚀 使用

配置完成后，重启您的 IDE/工具即可使用。

### 基础功能

```
获取我的任务
获取我的Bug
获取所有产品列表
获取产品230的需求列表
查看需求2508的详情
```

### 关联关系查询

```
获取需求2508关联的所有Bug
查看Bug 20692关联的需求
```

### 批量操作

```
批量更新任务状态为进行中
批量解决Bug，标记为已修复
```

### 数据统计

```
查看我的任务统计
查看我的Bug统计
```

### AI 编程辅助

```
获取需求2508的完整开发上下文（包含关联的Bug和测试用例）
生成需求2508的Markdown摘要
生成Bug 20692的Markdown摘要
格式化任务123为Markdown
```

### 智能分析

```
分析需求2508的复杂度
分析Bug 20692的优先级
分析任务123的工作量
```

### 代码生成提示

```
根据需求2508生成代码框架提示
根据Bug 20692生成测试用例提示
生成需求2508的代码审查检查清单
```

### 数据导出

```
导出需求2508到文件
导出Bug 20692到文件
导出模块1384的所有需求
导出2025年的所有需求
导出包含"接福"关键词的需求
```

## 📋 可用工具

### 配置管理

- `initZentao` - 初始化禅道连接
- `getConfig` - 查看配置信息

### 项目管理

- `getProjects` - 获取项目列表
- `getProject` - 获取项目详情
- `createProject` - 创建项目。结束日期必须晚于开始日期，并且要关联产品
- `deleteProject` - 删除项目。不会删除项目下的任务
- `getProjectTasks` - 获取项目里的任务
- `getProjectBuilds` - 获取项目里的版本

### 任务管理

- `getMyTasks` - 获取我的任务列表
- `getTaskDetail` - 获取任务详情
- `createTask` - 创建任务。需要项目编号
- `startTask` - 开始任务
- `closeTask` - 关闭任务
- `assignTask` - 指派任务
- `updateTask` - 更新任务
- `finishTask` - 完成任务
- `deleteTask` - 删除任务

### Bug 管理

- `getMyBugs` - 获取我的Bug列表
- `getBugDetail` - 获取Bug详情
- `getProductBugs` - 获取产品的Bug列表（支持按模块和状态筛选）
- `createBug` - 创建 Bug
- `resolveBug` - 解决Bug
- `closeBug` - 关闭 Bug
- `activateBug` - 激活 Bug
- `assignBug` - 指派 Bug
- `deleteBug` - 删除 Bug

### 产品管理

- `getProducts` - 获取产品列表

### 需求管理

- `getProductStories` - 获取产品的需求列表
- `getStoryDetail` - 获取需求详情
- `searchStories` - 搜索需求
- `searchStoriesByProductName` - 按产品名称搜索需求
- `createStory` - 创建需求。默认不进评审，直接激活
- `changeStory` - 变更需求。激活需求变更后状态变为 changed
- `closeStory` - 关闭需求
- `activateStory` - 激活需求
- `deleteStory` - 删除需求

### 测试用例管理

- `getProductTestCases` - 获取产品的测试用例
- `getTestCaseDetail` - 获取测试用例详情
- `createTestCase` - 创建测试用例
- `getStoryTestCases` - 获取需求的测试用例
- `deleteTestCase` - 删除测试用例

### 版本和测试单

- `createBuild` - 创建版本
- `deleteBuild` - 删除版本
- `getTestTasks` - 获取测试单列表
- `getTestTaskDetail` - 获取测试单详情
- `getTestTaskResults` - 获取测试单的测试结果
- `createTestTask` - 创建测试单
- `linkTestCase` - 把用例关联到测试单
- `deleteTestTask` - 删除测试单
- `runTestCase` - 执行测试用例。`taskId` 是测试执行记录 id（`getTestTaskResults` 返回的 id），不是测试单 id

### 关联关系查询

- `getStoryRelatedBugs` - 获取需求关联的 Bug 列表
- `getBugRelatedStory` - 获取 Bug 关联的需求

### 批量操作

- `batchUpdateTasks` - 批量更新任务
- `batchResolveBugs` - 批量解决 Bug

### 数据统计

- `getMyTaskStatistics` - 获取我的任务统计信息
- `getMyBugStatistics` - 获取我的 Bug 统计信息

### AI 编程辅助功能

- `getDevelopmentContext` - 获取需求/Bug 的完整开发上下文（包含关联信息）
- `generateStorySummary` - 生成需求摘要（支持 JSON/Markdown/文本格式）
- `generateBugSummary` - 生成 Bug 摘要（支持 JSON/Markdown/文本格式）
- `formatTaskAsMarkdown` - 将任务格式化为 Markdown

### 智能分析功能

- `analyzeStoryComplexity` - 分析需求复杂度（评分、工时估算、优先级建议）
- `analyzeBugPriority` - 分析 Bug 优先级（评分、优先级建议）
- `analyzeTaskWorkload` - 分析任务工作量（工时估算、难度评估）

### 代码生成提示

- `generateCodePromptFromStory` - 根据需求生成代码框架提示
- `generateTestPromptFromBug` - 根据 Bug 生成测试用例提示
- `generateCodeReviewChecklist` - 生成代码审查检查清单

### 数据导出

- `exportItems` - 统一导出接口（支持单个、模块批量、搜索批量导出，含图片，仅支持 Markdown 格式）
- `getModuleItems` - 根据模块链接获取对应的需求、用例或Bug（JSON格式，已包含图片信息）
- `exportModuleItemsAsMarkdown` - 根据模块链接导出需求、用例或Bug为Markdown格式（已包含图片）
- `exportStoriesBySearch` - 根据搜索条件导出需求（支持自然语言，已包含图片，仅支持 Markdown 格式）
- `exportStory` - 导出单个需求到文件（仅支持 Markdown 格式，含图片）
- `exportBug` - 导出单个Bug到文件（仅支持 Markdown 格式，含图片）

> **提示**：所有导出功能都会自动下载并保存图片到本地 `images/` 子目录，Markdown 文件中的图片链接会自动替换为相对路径。

## 📝 许可证

MIT

## 🔗 相关链接

- [禅道开源版 GitHub](https://github.com/easysoft/zentaopms) - 禅道官方 GitHub 仓库
- [禅道官网](https://www.zentao.net/)
