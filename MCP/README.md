# Hdev MCP Export

这个目录是从仓库中导出的 MCP 运行包，目标是便于单独分发和部署。

当前导出的签名格式已经同步主项目最新规则：
- 按 HDevelop `interface` 中的原始顺序显示参数
- 签名中包含 `INPUT` / `OUTPUT` 标识
- 同时显示参数类型与参数名，例如 `([INPUT] ctrl AddStr, [OUTPUT] iconic ImageOut)`

## 目录说明

- `dist/mcp/mcp-server.js`: 完整版 MCP Server
- `dist/mcp/HdevParser.js`: Hdev 解析器
- `dist/mcp-simple/mcp-server-simple.js`: 简化版 MCP Server
- `docs/`: 相关部署和使用文档
- `package.json`: 最小运行依赖

## 安装

```bash
npm install
```

## 运行

完整版：

```bash
npm run start
```

简化版：

```bash
npm run start:simple
```

## 环境变量

- `WORKSPACE_PATH`: Hdev 文件所在目录；未设置时默认使用当前工作目录

## Claude Desktop 示例

```json
{
  "mcpServers": {
    "hdev": {
      "command": "node",
      "args": ["dist/mcp/mcp-server.js"],
      "cwd": "E:\\\\Developer\\\\vscode-halcon-hdevelop\\\\MCP",
      "env": {
        "WORKSPACE_PATH": "E:\\\\Developer\\\\your-hdev-project"
      }
    }
  }
}
```
