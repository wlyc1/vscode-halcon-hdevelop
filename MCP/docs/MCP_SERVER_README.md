# Hdev MCP Server - AI 快速读取 Hdev 代码解决方案

## 概述

本 MCP (Model Context Protocol) Server 专为 AI 设计，用于快速且正确地读取和解析 Hdev (Halcon Development) 代码文件。通过提供结构化的工具接口，AI 可以高效地搜索、浏览和理解 Hdev 代码。

## 核心功能

### 1. 文件发现
- `list_hdev_files` - 列出工作空间中所有 Hdev 文件及其包含的 procedures

### 2. 代码获取
- `get_hdev_file` - 获取完整 Hdev 文件内容（AI 友好格式）
- `get_hdev_procedure` - 获取单个 procedure 的详细信息

### 3. 智能搜索
- `search_hdev_code` - 支持多维度搜索：
  - Procedure 名称
  - 代码内容
  - 参数名称
  - 参数描述

### 4. 调用分析
- `get_hdev_call_graph` - 获取 procedure 的调用链

## 技术架构

### HdevParser 解析器

```
Hdev XML 文件 → HdevParser → 结构化数据 → AI 友好格式
```

解析流程：
1. **XML 解析** - 使用 fast-xml-parser 解析 Hdev 的 XML 格式
2. **Procedure 提取** - 提取接口定义、代码体、文档
3. **参数分析** - 解析 input/output objects 和 controls
4. **调用检测** - 识别 procedure 之间的调用关系
5. **索引构建** - 创建内存索引用于快速搜索

### 数据结构

```typescript
interface ProcedureInfo {
  name: string;           // Procedure 名称
  signature: string;      // 函数签名
  parameters: {
    input_objects: ParameterInfo[];
    output_objects: ParameterInfo[];
    input_controls: ParameterInfo[];
    output_controls: ParameterInfo[];
  };
  code: CodeLine[];       // 代码行
  docu: Map<string, ParameterDocu>;  // 文档
  calls: string[];        // 调用的其他 procedures
}
```

## 安装与配置

### 1. 安装依赖

```bash
npm install fast-xml-parser @modelcontextprotocol/sdk
```

### 2. Claude Desktop 配置

在 Claude Desktop 配置文件中添加：

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

### 3. 其他 MCP 客户端配置

对于其他 MCP 客户端，使用类似的配置格式，确保：
- 设置正确的工作目录
- 设置 `WORKSPACE_PATH` 环境变量指向 Hdev 文件所在目录

## 工具使用示例

### 列出所有 Hdev 文件

```
Tool: list_hdev_files
Input: {}
```

输出示例：
```json
[
  {
    "path": "e:\\project\\main.hdev",
    "procedures": ["main", "init_camera", "process_image"],
    "halconVersion": "22.11"
  }
]
```

### 搜索代码

```
Tool: search_hdev_code
Input: {
  "query": "threshold",
  "limit": 5
}
```

输出示例：
```json
[
  {
    "procedure": "process_image",
    "file": "e:\\project\\main.hdev",
    "signature": "([INPUT] iconic Image, [OUTPUT] iconic Region)",
    "calls": ["threshold", "connection"],
    "preview": "threshold(Image, Region, 128)\nconnection(Region, Connected)"
  }
]
```

### 获取 Procedure 详情

```
Tool: get_hdev_procedure
Input: {
  "procedureName": "process_image"
}
```

输出示例：
```
## Procedure: process_image([INPUT] iconic Image, [OUTPUT] iconic Region)

### Parameters:
- [INPUT_OBJECT] object Image
- [OUTPUT_OBJECT] object Region

### Code:
```hdevelop
threshold(Image, Region, 128)
connection(Region, Connected)
```

### Calls: threshold, connection
```

## AI 友好格式特性

### 1. 结构化输出
- 清晰的 Markdown 格式
- 参数分类显示（INPUT/OUTPUT, OBJECT/CONTROL）
- 代码块语法高亮

### 2. 语义化搜索
- 支持模糊匹配
- 多字段搜索（名称、代码、参数、描述）
- 相关性排序

### 3. 增量索引
- 启动时构建完整索引
- 内存缓存加速重复查询
- 支持大文件快速定位

## 性能优化

### 索引构建
```
扫描文件 → 解析 XML → 提取 Procedures → 构建索引 → 内存缓存
```

### 搜索算法
1. 名称匹配（最高优先级）
2. 代码内容匹配
3. 参数名称匹配
4. 参数描述匹配

### 调用图分析
- 自动检测 procedure 调用关系
- 排除内置 Halcon 算子
- 支持递归调用链追踪

## 内置 Halcon 算子过滤

以下 Halcon 内置算子不会被识别为 procedure 调用：

- 图像处理：`threshold`, `connection`, `select_shape`, `region` 等
- 图像采集：`read_image`, `grab_image`, `open_framegrabber` 等
- 形态学：`opening_circle`, `closing_circle`, `dilation_circle` 等
- 变换：`affine_trans_image`, `projective_trans_image` 等
- 显示：`dev_display`, `dev_set_color`, `dev_set_draw` 等
- 元组操作：`tuple_length`, `tuple_select`, `tuple_concat` 等
- 文件操作：`open_file`, `close_file`, `fwrite_string` 等
- 控制流：`if`, `for`, `while`, `try`, `catch` 等

## 故障排除

### 问题：找不到 Hdev 文件
**解决**：确保 `WORKSPACE_PATH` 环境变量设置正确，且目录中包含 `.hdev` 文件

### 问题：Procedure 未找到
**解决**：检查 procedure 名称拼写，使用 `search_hdev_code` 进行模糊搜索

### 问题：调用关系不准确
**解决**：如果某些自定义 procedure 被误判为内置算子，需要将其添加到过滤列表中

## 扩展开发

### 添加新工具

1. 在 `setupToolHandlers()` 中注册新工具
2. 实现对应的处理方法
3. 在 `CallToolRequestSchema` 处理器中添加 case

### 自定义解析逻辑

修改 `HdevParser` 类中的方法：
- `parseProcedure()` - 自定义 procedure 解析
- `extractCalls()` - 自定义调用检测逻辑
- `formatProcedureForAI()` - 自定义输出格式

## 最佳实践

1. **首次查询使用较小 limit** - 避免返回过多结果
2. **使用具体名称搜索** - 比模糊搜索更准确
3. **利用调用图理解依赖** - 分析 procedure 之间的关系
4. **结合多个工具使用** - 先搜索再获取详情

## 许可证

MIT License
