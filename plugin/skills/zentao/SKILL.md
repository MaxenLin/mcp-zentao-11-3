---
name: zentao
description: 查询和更新禅道 11.3 的产品、需求、任务、Bug、用例和测试单。用户提到禅道、Zentao、需求、Bug、任务、测试单，或给出禅道编号时使用。
---

# 禅道

同一个 `zentao` 程序既是命令行，也是 MCP。会话里已经有禅道工具（例如 `getProducts`、`getStoryDetail`、`getMyTasks`）时，读数据用这些工具。没有这些工具时，在终端运行 `zentao`。不要对同一次查询两边都做。

## 配置

先运行 `zentao config`。没有配置时，向用户要地址、用户名和密码，再执行 `zentao config set --url URL --username USER --password PASS`。地址要带 `/zentao`。不要在回复里重复密码。

`zentao` 不在 PATH 里时，告诉用户执行 `npm install -g @maxenlin/mcp-zentao-11-3`。

## 查询

完整命令以 `zentao --help` 为准。常用：

- `zentao ping`
- `zentao products`
- `zentao stories --product <id>`。默认只有激活需求，全部状态加 `--status all`
- `zentao story <id>`
- `zentao tasks`、`zentao task <id>`
- `zentao bugs --product <id>`、`zentao bug <id>`
- `zentao search <关键字> --product <id> --status all`。不带产品会拉全部产品，很慢
- `zentao cases --product <id>`、`zentao testtasks --product <id>`

需要解析结果时加 `--json`。

## 修改

这些命令会改禅道数据。先告诉用户将要改什么，得到明确同意后再执行。

- 项目：`project create`、`project delete`。删除项目不会删掉下面的任务
- 任务：`task create`、`task start`、`task close`、`task assign`、`task update`、`task finish`、`task delete`
- Bug：`bug create`、`bug resolve`、`bug close`、`bug activate`、`bug assign`、`bug delete`
- 需求：`story create`、`story change`、`story close`、`story activate`、`story delete`
- 版本和测试：`build create`、`build delete`、`testtask create`、`testtask link`、`testtask delete`、`case delete`

MCP 里同名的写工具也要先确认。建任务、建版本、建测试单都要有项目编号。
