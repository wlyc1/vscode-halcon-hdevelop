# Hdev MCP Server 部署与使用指南

## 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [部署方式](#部署方式)
- [配置示例](#配置示例)
- [使用案例](#使用案例)
- [常见问题](#常见问题)

---

## 快速开始

### 1. 安装依赖

```bash
cd /path/to/vscode-halcon-hdevelop
npm install
```

### 2. 启动 MCP Server

```bash
npx ts-node --transpile-only src/mcp-server-simple.ts
```

### 3. 在 MCP 客户端中配置

在你的 MCP 客户端配置文件中添加 Hdev Server 配置（详见下方配置示例）。

---

## 项目结构

```
vscode-halcon-hdevelop/
├── src/
│   ├── mcp-server-simple.ts    # MCP Server 主程序
│   ├── HDevelopSerializer.ts   # Hdev 序列化器（可选）
│   └── HDevelopFormatter.ts    # Hdev 格式化器（可选）
├── docs/
│   ├── MCP_DEPLOYMENT.md       # 本部署文档
│   └── MCP_SERVER_README.md    # 技术文档
├── package.json                # 项目配置
└── tsconfig.json               # TypeScript 配置
```

### 核心文件说明

| 文件 | 说明 | 是否必需 |
|------|------|----------|
| `src/mcp-server-simple.ts` | MCP Server 主程序 | ✅ 必需 |
| `package.json` | 依赖配置 | ✅ 必需 |
| `tsconfig.json` | TypeScript 配置 | ✅ 必需 |

---

## 部署方式

### 方式一：原地部署（推荐）

直接在当前项目目录运行，适用于：
- 本地开发测试
- Hdev 文件在同一项目或子目录中

**步骤：**

1. 确保项目依赖已安装：
   ```bash
   npm install
   ```

2. 启动 Server：
   ```bash
   npx ts-node --transpile-only src/mcp-server-simple.ts
   ```

3. 配置 MCP 客户端指向工作目录

### 方式二：独立部署

将 MCP Server 部署到独立目录，适用于：
- 多个项目共享同一个 MCP Server
- 生产环境部署

**步骤：**

1. 创建部署目录：
   ```bash
   mkdir -p /opt/hdev-mcp-server
   cd /opt/hdev-mcp-server
   ```

2. 复制必要文件：
   ```bash
   cp /path/to/vscode-halcon-hdevelop/src/mcp-server-simple.ts ./
   cp /path/to/vscode-halcon-hdevelop/package.json ./
   cp /path/to/vscode-halcon-hdevelop/tsconfig.json ./
   ```

3. 安装依赖：
   ```bash
   npm install --production
   ```

4. 创建启动脚本 `start.sh`：
   ```bash
   #!/bin/bash
   export WORKSPACE_PATH="/path/to/your/hdev/files"
   npx ts-node --transpile-only src/mcp-server-simple.ts
   ```

5. 配置 MCP 客户端

### 方式三：Docker 部署（高级）

创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制项目文件
COPY package.json tsconfig.json ./
COPY src/ ./src/

# 安装依赖
RUN npm install --production

# 设置环境变量
ENV WORKSPACE_PATH=/hdev

# 挂载 Hdev 文件目录
VOLUME /hdev

# 启动命令
CMD ["npx", "ts-node", "--transpile-only", "src/mcp-server-simple.ts"]
```

构建和运行：

```bash
docker build -t hdev-mcp-server .
docker run -v /path/to/your/hdev:/hdev hdev-mcp-server
```

---

## 配置示例

### Claude Desktop (Windows)

配置文件位置：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "e:\\Developer\\vscode-halcon-hdevelop",
      "env": {
        "WORKSPACE_PATH": "e:\\Developer\\vscode-halcon-hdevelop"
      }
    }
  }
}
```

### Claude Desktop (macOS/Linux)

配置文件位置：`~/Library/Application Support/Claude/claude_desktop_config.json` 或 `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "/home/user/projects/vscode-halcon-hdevelop",
      "env": {
        "WORKSPACE_PATH": "/home/user/projects/vscode-halcon-hdevelop"
      }
    }
  }
}
```

### Cursor IDE

在项目根目录创建 `.cursor/mcp.json`：

```json
{
  "servers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "${workspaceFolder}",
      "env": {
        "WORKSPACE_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

### Windsurf IDE

在项目根目录创建 `.windsurf/mcp.json`：

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "${workspaceFolder}",
      "env": {
        "WORKSPACE_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

### 通用 MCP 配置格式

```json
{
  "mcpServers": {
    "服务器名称": {
      "command": "命令",
      "args": ["参数 1", "参数 2"],
      "cwd": "工作目录",
      "env": {
        "环境变量名": "环境变量值"
      }
    }
  }
}
```

**配置参数说明：**

| 参数 | 说明 | 是否必需 |
|------|------|----------|
| `command` | 启动命令（如 `npx`, `node`, `python`） | ✅ |
| `args` | 命令参数数组 | ✅ |
| `cwd` | 工作目录（项目根目录） | ✅ |
| `env` | 环境变量 | 可选 |
| `env.WORKSPACE_PATH` | Hdev 文件所在目录 | ✅ |

---

## 使用案例

### 案例 1：本地开发环境

**场景：** 在本地开发 Halcon 视觉项目，需要 AI 帮助理解现有代码。

**配置：**

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "D:\\Projects\\VisionProject",
      "env": {
        "WORKSPACE_PATH": "D:\\Projects\\VisionProject"
      }
    }
  }
}
```

**使用流程：**

1. 在 AI 对话中请求列出所有 Hdev 文件
2. 搜索特定功能的实现（如 "查找所有使用 threshold 的代码"）
3. 获取具体 procedure 的详细信息
4. 分析调用关系理解代码结构

### 案例 2：多项目共享 Server

**场景：** 多个 Halcon 项目需要共享同一个 MCP Server。

**部署：**

```bash
# 1. 创建共享 Server 目录
mkdir C:\MCP-Servers\hdev

# 2. 复制文件
cp src/mcp-server-simple.ts C:\MCP-Servers\hdev\
cp package.json C:\MCP-Servers\hdev\
cp tsconfig.json C:\MCP-Servers\hdev\

# 3. 安装依赖
cd C:\MCP-Servers\hdev
npm install --production
```

**配置（在每个项目中）：**

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "C:\\MCP-Servers\\hdev",
      "env": {
        "WORKSPACE_PATH": "D:\\Projects\\CurrentProject"
      }
    }
  }
}
```

### 案例 3：CI/CD 集成

**场景：** 在 CI/CD 流程中使用 MCP Server 进行代码分析。

**GitHub Actions 示例：**

```yaml
name: Hdev Code Analysis

on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
    
    - name: Install dependencies
      run: npm install
    
    - name: Start MCP Server
      run: |
        npx ts-node --transpile-only src/mcp-server-simple.ts &
        sleep 5
    
    - name: Run analysis
      run: |
        # 使用 curl 或其他工具调用 MCP Server
        # 这里根据具体需求编写分析脚本
        echo "Analysis complete"
```

---

## 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `WORKSPACE_PATH` | Hdev 文件搜索根目录 | 当前工作目录 |

---

## 常见问题

### Q1: 启动时提示 "Cannot find module"

**原因：** 依赖未安装或路径不正确

**解决：**
```bash
npm install
# 确保在正确的目录运行
```

### Q2: 找不到 Hdev 文件

**原因：** `WORKSPACE_PATH` 配置错误

**解决：**
1. 检查 `WORKSPACE_PATH` 是否指向正确的目录
2. 确认目录中包含 `.hdev` 文件
3. 检查目录权限

### Q3: TypeScript 编译错误

**原因：** zod v4 与 TypeScript 版本不兼容

**解决：**
使用 `ts-node --transpile-only` 跳过类型检查：
```bash
npx ts-node --transpile-only src/mcp-server-simple.ts
```

### Q4: MCP Server 无响应

**原因：** 索引构建中或文件过多

**解决：**
1. 等待索引构建完成（查看 stderr 日志）
2. 减少 `WORKSPACE_PATH` 目录范围
3. 检查日志输出

### Q5: 如何在多个工作区切换？

**方案 A：** 在每个工作区配置独立的 MCP Server

**方案 B：** 使用绝对路径配置，修改 `WORKSPACE_PATH` 环境变量

---

## 日志与调试

### 查看日志

MCP Server 的日志输出到 stderr：

```bash
# 启动时保存日志
npx ts-node --transpile-only src/mcp-server-simple.ts 2> mcp-server.log
```

### 调试模式

添加 `DEBUG` 环境变量：

```json
{
  "mcpServers": {
    "hdev": {
      "command": "npx",
      "args": ["ts-node", "--transpile-only", "src/mcp-server-simple.ts"],
      "cwd": "/path/to/project",
      "env": {
        "WORKSPACE_PATH": "/path/to/project",
        "DEBUG": "hdev:*"
      }
    }
  }
}
```

---

## 性能优化建议

1. **限制搜索范围**
   - 将 `WORKSPACE_PATH` 设置为包含 Hdev 文件的最小目录
   - 避免设置为根目录如 `C:\`

2. **使用索引缓存**
   - Server 启动时会自动构建索引
   - 保持 Server 长运行避免重复构建

3. **批量查询**
   - 使用 `search_hdev_code` 代替多次 `get_hdev_procedure`
   - 设置合适的 `limit` 参数

---

## 更新与维护

### 更新 Server

```bash
# 拉取最新代码
git pull origin main

# 重新安装依赖
npm install

# 重启 Server
```

### 备份配置

保存你的 MCP 配置文件到安全位置，便于恢复。

---

## 技术支持

- 项目仓库：https://github.com/wlyc1/vscode-halcon-hdevelop
- 问题反馈：提交 Issue

---

## 许可证

MIT License