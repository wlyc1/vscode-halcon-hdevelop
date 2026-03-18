# Hdev MCP Server 使用指南

## 概述

Hdev MCP Server 为 AI 助手（如 Cline）提供访问和解析 Halcon HDevelop 代码的能力。通过 Model Context Protocol (MCP)，AI 可以调用工具来：

- 列出和解析 Hdev 文件
- 搜索代码和参数
- 获取 procedure 详细信息
- 分析调用关系图

## 安装

### 1. 安装依赖

```bash
npm install
```

### 2. 构建 MCP Server

```bash
npm run build:mcp
```

## 配置 MCP Server

### 在 Claude Desktop 中配置

编辑 Claude Desktop 配置文件：

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hdev": {
      "command": "node",
      "args": ["<项目绝对路径>/dist/mcp/mcp-server.js"],
      "cwd": "<项目绝对路径>"
    }
  }
}
```

### 在 Cline (VSCode) 中配置

在 VSCode 中，MCP Server 会自动通过 cocoindex-code 等已连接的服务器进行代码搜索。

如需单独配置，可以在 Cline 的设置中添加：

```json
{
  "mcp": {
    "hdev": {
      "command": "node",
      "args": ["<项目绝对路径>/dist/mcp/mcp-server.js"],
      "cwd": "<项目绝对路径>"
    }
  }
}
```

## 可用工具

### 1. `list_files` - 列出 Hdev 文件

列出指定目录下的所有 Hdev 文件。

**参数**:
- `directory` (可选): 目录路径，默认为当前工作目录
- `pattern` (可选): 文件匹配模式，如 `*.hdev`

**示例**:
```json
{
  "query": "list_files",
  "arguments": {
    "directory": "/path/to/hdev/files",
    "pattern": "*.hdev"
  }
}
```

### 2. `parse_file` - 解析 Hdev 文件

解析单个 Hdev 文件，返回结构化的 procedure 信息。

**参数**:
- `filePath` (必需): Hdev 文件路径

**示例**:
```json
{
  "query": "parse_file",
  "arguments": {
    "filePath": "/path/to/Log_Out.hdev"
  }
}
```

**返回**:
```json
{
  "filePath": "/path/to/Log_Out.hdev",
  "fileVersion": "1.2",
  "halconVersion": "20.11.0.0",
  "procedures": [
    {
      "name": "main",
      "signature": "()",
      "paramCount": { ... },
      "codeLines": 1,
      "calls": ["Log_Out"]
    }
  ]
}
```

### 3. `list_procedures` - 列出 Procedures

列出所有已解析的 procedure 及其签名。

**参数**:
- `filePath` (可选): 只列出指定文件的 procedures

**示例**:
```json
{
  "query": "list_procedures",
  "arguments": {
    "filePath": "/path/to/Log_Out.hdev"
  }
}
```

### 4. `get_procedure` - 获取 Procedure 详情

获取指定 procedure 的完整信息。

**参数**:
- `procedureName` (必需): Procedure 名称
- `format` (可选): 返回格式 (`json`, `markdown`, `plain`)

**示例**:
```json
{
  "query": "get_procedure",
  "arguments": {
    "procedureName": "Log_Out",
    "format": "markdown"
  }
}
```

**Markdown 格式返回**:
```markdown
## Procedure: Log_Out([INPUT] ctrl AddStr, [INPUT] ctrl logPath)

### Parameters:
- [INPUT_CONTROL] ctrl AddStr - 写出字符串
- [INPUT_CONTROL] ctrl logPath - 写出的 Log 文件路径

### Code:
```hdevelop
fileOpen := 0
try
    file_exists (logPath, FileExists)
...
```

### Calls: file_exists, open_file, fwrite_string
```

### 5. `search_code` - 搜索代码

在 Hdev 代码中搜索，支持名称、代码内容、参数名和描述匹配。

**参数**:
- `query` (必需): 搜索关键词
- `limit` (可选): 最大返回结果数，默认 10
- `filePath` (可选): 只在指定文件中搜索

**示例**:
```json
{
  "query": "search_code",
  "arguments": {
    "query": "log",
    "limit": 5
  }
}
```

### 6. `get_parameter_info` - 获取参数信息

获取 procedure 参数的详细信息。

**参数**:
- `procedureName` (必需): Procedure 名称
- `parameterName` (可选): 参数名称

**示例**:
```json
{
  "query": "get_parameter_info",
  "arguments": {
    "procedureName": "Log_Out",
    "parameterName": "AddStr"
  }
}
```

### 7. `get_call_graph` - 获取调用关系图

获取 procedure 的调用关系图。

**参数**:
- `procedureName` (可选): Procedure 名称，不指定则返回所有
- `depth` (可选): 调用链展开深度，默认 1

**示例**:
```json
{
  "query": "get_call_graph",
  "arguments": {
    "procedureName": "main",
    "depth": 3
  }
}
```

### 8. `get_file_content` - 获取原始文件内容

获取 Hdev 文件的原始 XML 内容。

**参数**:
- `filePath` (必需): Hdev 文件路径

**示例**:
```json
{
  "query": "get_file_content",
  "arguments": {
    "filePath": "/path/to/Log_Out.hdev"
  }
}
```

## 使用场景

### 场景 1: AI 辅助代码理解

当 AI 需要理解 Hdev 代码时，可以：

1. 首先调用 `list_files` 找到相关文件
2. 调用 `parse_file` 解析文件结构
3. 调用 `get_procedure` 获取具体 procedure 的详细信息

### 场景 2: 代码搜索和定位

当需要查找特定功能的代码时：

1. 调用 `search_code` 搜索关键词
2. 从结果中找到目标 procedure
3. 调用 `get_procedure` 获取完整代码

### 场景 3: 依赖分析

当需要理解代码调用关系时：

1. 调用 `get_call_graph` 获取调用链
2. 递归分析被调用的 procedure

## 数据结构

### ProcedureInfo

```typescript
interface ProcedureInfo {
  name: string;
  signature: string;
  parameters: {
    input_objects: ParameterInfo[];
    output_objects: ParameterInfo[];
    input_controls: ParameterInfo[];
    output_controls: ParameterInfo[];
  };
  code: CodeLine[];
  docu: Map<string, ParameterDocu>;
  calls: string[];
}
```

### ParameterInfo

```typescript
interface ParameterInfo {
  name: string;
  baseType: string;  // "ctrl" 或 "iconic"
  dimension: number;
  ioType: 'input_object' | 'output_object' | 'input_control' | 'output_control';
  description?: string;
  typeList?: string[];
}
```

## 最佳实践

1. **先解析后查询**: 先调用 `parse_file` 将文件加载到内存索引中，后续查询会更快

2. **使用合适的格式**: 
   - 程序处理使用 `json` 格式
   - AI 阅读使用 `markdown` 格式
   - 简单查看使用 `plain` 格式

3. **限制搜索结果**: 使用 `limit` 参数避免返回过多数据

4. **利用调用图**: 分析复杂代码时，先用 `get_call_graph` 了解结构

## 故障排除

### 问题：MCP Server 无法启动

**解决方案**:
1. 确保已运行 `npm install` 安装依赖
2. 确保已运行 `npm run build:mcp` 构建服务器
3. 检查配置文件中的路径是否正确

### 问题：找不到 Procedure

**解决方案**:
1. 确保文件已被 `parse_file` 解析过
2. 检查 procedure 名称是否正确（区分大小写）

### 问题：搜索结果为空

**解决方案**:
1. 尝试不同的关键词
2. 搜索会匹配 procedure 名、代码内容、参数名和描述
3. 检查文件是否已被解析到索引中

## 扩展开发

如需添加新的工具，在 `src/mcp-server.ts` 中：

1. 在 `TOOLS` 数组中添加工具定义
2. 在 `setupToolHandlers` 中添加处理逻辑
3. 在 `HdevParser` 中添加相应的解析方法

## 许可证

MIT License
