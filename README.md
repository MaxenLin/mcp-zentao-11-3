# @maxenlin/mcp-zentao-11-3

禅道 11.3 Legacy 版 MCP 服务器，支持所有兼容 MCP 协议的 IDE 和工具（如 Cursor IDE、Claude Desktop、Continue 等），只支持旧版 Session API。

## ✨ 特性

- ✅ **纯 Legacy API** - 只支持禅道 11.x 版本的 Session API
- ✅ **功能完整** - 支持任务、Bug、需求、测试用例等完整功能
- ✅ **AI 编程优化** - 提供完整开发上下文、格式化输出、智能摘要等功能
- ✅ **开箱即用** - 配置简单，专注核心功能

## 📋 系统要求

- **Node.js**: >= 18.0.0（推荐使用 LTS 版本）

## 📦 安装

### 方法 1：本地安装

```bash
npm install -g @maxenlin/mcp-zentao-11-3
```

然后在支持 MCP 的 IDE/工具配置文件中添加（以 Cursor IDE 为例）：

```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "mcp-zentao-11-3",
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

> **提示**：工作空间路径会自动检测，批量导出功能会将文件保存到当前项目工作空间的 `export/` 目录。

### 方法 2：使用 npx

在支持 MCP 的 IDE/工具配置文件中添加（以 Cursor IDE 为例）：

```json
{
  "mcpServers": {
    "zentao-11-3": {
      "command": "npx",
      "args": ["-y", "@maxenlin/mcp-zentao-11-3"],
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

### 任务管理

- `getMyTasks` - 获取我的任务列表
- `getTaskDetail` - 获取任务详情
- `updateTask` - 更新任务
- `finishTask` - 完成任务

### Bug 管理

- `getMyBugs` - 获取我的Bug列表
- `getBugDetail` - 获取Bug详情
- `getProductBugs` - 获取产品的Bug列表（支持按模块和状态筛选）
- `resolveBug` - 解决Bug

### 产品管理

- `getProducts` - 获取产品列表

### 需求管理

- `getProductStories` - 获取产品的需求列表
- `getStoryDetail` - 获取需求详情
- `searchStories` - 搜索需求
- `searchStoriesByProductName` - 按产品名称搜索需求

### 测试用例管理

- `getProductTestCases` - 获取产品的测试用例
- `getTestCaseDetail` - 获取测试用例详情
- `createTestCase` - 创建测试用例
- `getStoryTestCases` - 获取需求的测试用例

### 测试单管理

- `getTestTasks` - 获取测试单列表
- `getTestTaskDetail` - 获取测试单详情
- `getTestTaskResults` - 获取测试单的测试结果
- `runTestCase` - 执行测试用例

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

### 根据需求/Bug创建任务

- `createTaskFromStory` - 根据需求创建任务（提供手动操作指南）
- `createTaskFromBug` - 根据Bug创建修复任务（提供手动操作指南）

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
