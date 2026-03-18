# AI 集成 Hdev 代码访问 - 快速指南

## 核心组件

### 1. HdevParser (`src/HdevParser.ts`)
独立的 Hdev 代码解析器，提供：
- XML 解析
- Procedure 信息提取
- 代码搜索
- 调用图分析
- AI 友好的文本格式化

### 2. MCP Server (`src/mcp-server.ts`)
基于 Model Context Protocol 的服务器，提供 8 个工具：

| 工具 | 功能 |
|------|------|
| `list_files` | 列出 Hdev 文件 |
| `parse_file` | 解析文件结构 |
| `list_procedures` | 列出所有 procedure |
| `get_procedure` | 获取 procedure 详情 |
| `search_code` | 搜索代码 |
| `get_parameter_info` | 获取参数信息 |
| `get_call_graph` | 获取调用关系图 |
| `get_file_content` | 获取原始 XML |

## 快速开始

### 安装
```bash
npm install
npm run build:mcp
```

### 配置 MCP Server

在 AI 客户端（如 Claude Desktop）配置文件中添加：

```json
{
  "mcpServers": {
    "hdev": {
      "command": "node",
      "args": ["e:/Developer/vscode-halcon-hdevelop/dist/mcp/mcp-server.js"],
      "cwd": "e:/Developer/vscode-halcon-hdevelop"
    }
  }
}
```

### AI 使用示例

**示例 1: 解析并读取 procedure**
```
AI: 调用 parse_file 解析 Log_Out.hdev
AI: 调用 get_procedure 获取 Log_Out 的详细信息，格式为 markdown
```

**示例 2: 搜索代码**
```
AI: 调用 search_code 搜索 "file_exists"
AI: 从结果中找到相关 procedure 并调用 get_procedure 获取详情
```

**示例 3: 分析调用关系**
```
AI: 调用 get_call_graph 获取 main 的调用链，深度为 3
AI: 递归获取被调用 procedure 的信息
```

## 输出格式示例

### get_procedure (markdown 格式)
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
    if (false==FileExists)
    endif
    open_file (logPath, 'append', FileHandle)
    fileOpen := 1
    fwrite_string (FileHandle, AddStr+'\n')
    close_file (FileHandle)
catch (Exception)
    try
        if (fileOpen)
            close_file (FileHandle)
        endif
    catch (Exception)
    endtry
endtry
return ()
```

### Calls: file_exists, open_file, fwrite_string, close_file
```

### search_code 返回
```json
{
  "query": "log",
  "totalResults": 2,
  "returnedResults": 2,
  "results": [
    {
      "name": "Log_Out",
      "signature": "([INPUT] ctrl AddStr, [INPUT] ctrl logPath)",
      "file": "e:/path/to/Log_Out.hdev",
      "code": "fileOpen := 0\ntry\n...",
      "parameters": {...}
    }
  ]
}
```

## 架构优势

1. **快速**: 内存索引避免重复解析
2. **结构化**: JSON 输出便于 AI 理解
3. **多格式**: 支持 json/markdown/plain 格式
4. **可搜索**: 支持名称、代码、参数、描述多维度搜索
5. **调用分析**: 自动提取 procedure 调用关系
6. **参数读取**: 正确区分 `io/oo/ic/oc` 接口区段，避免 `get_parameter_info` 返回空参数

## 文件结构

```
vscode-halcon-hdevelop/
├── src/
│   ├── HdevParser.ts      # 核心解析器
│   ├── mcp-server.ts      # MCP 服务器
│   ├── HDevelopSerializer.ts  # VSCode 笔记本序列化器
│   └── ...
├── dist/mcp/              # 编译输出
│   ├── HdevParser.js
│   └── mcp-server.js
├── MCP_SERVER_GUIDE.md    # 详细使用指南
└── AI_INTEGRATION_README.md  # 本文件
```

## 与现有 cocoindex-code 集成

如果已使用 cocoindex-code 进行语义搜索，Hdev MCP Server 可作为补充：

- **cocoindex-code**: 适用于通用代码的语义搜索
- **Hdev MCP Server**: 专门针对 Hdev 格式，提供结构化数据和调用分析

两者可同时配置，AI 会根据需要选择合适的工具。
