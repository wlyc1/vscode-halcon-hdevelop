#!/usr/bin/env node
/**
 * Hdev MCP Server
 * 
 * 为 AI 提供访问 Hdev 代码的工具接口
 * 支持语义搜索、代码检索、调用链分析等功能
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { HdevParser, ProcedureInfo, HdevFileInfo, HdevIndex } from "./HdevParser";

// ==================== 工具定义 ====================

interface ListProceduresArgs {
  filePath?: string;
}

interface GetProcedureArgs {
  procedureName: string;
  format?: "json" | "markdown" | "plain";
}

interface SearchCodeArgs {
  query: string;
  limit?: number;
  filePath?: string;
}

interface GetParameterInfoArgs {
  procedureName: string;
  parameterName?: string;
}

interface GetCallGraphArgs {
  procedureName?: string;
  depth?: number;
}

interface ParseFileArgs {
  filePath: string;
}

interface ListFilesArgs {
  directory?: string;
  pattern?: string;
}

// ==================== 工具实现 ====================

const TOOLS: Tool[] = [
  {
    name: "list_files",
    description: "列出指定目录下的所有 Hdev 文件 (.hdev, .hdvp)",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "要搜索的目录路径，默认为当前工作目录",
        },
        pattern: {
          type: "string",
          description: "文件匹配模式，支持通配符，如 '*.hdev'",
        },
      },
      required: [],
    },
  },
  {
    name: "parse_file",
    description: "解析单个 Hdev 文件，返回结构化的 procedure 信息",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Hdev 文件路径",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "list_procedures",
    description: "列出所有已解析的 procedure 及其签名",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "可选，只列出指定文件的 procedures",
        },
      },
      required: [],
    },
  },
  {
    name: "get_procedure",
    description: "获取指定 procedure 的完整信息，包括参数、代码和文档",
    inputSchema: {
      type: "object",
      properties: {
        procedureName: {
          type: "string",
          description: "Procedure 名称",
        },
        format: {
          type: "string",
          enum: ["json", "markdown", "plain"],
          description: "返回格式，默认 json",
          default: "json",
        },
      },
      required: ["procedureName"],
    },
  },
  {
    name: "search_code",
    description: "在 Hdev 代码中搜索，支持名称、代码内容、参数名和描述匹配",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
        limit: {
          type: "number",
          description: "最大返回结果数，默认 10",
          default: 10,
        },
        filePath: {
          type: "string",
          description: "可选，只在指定文件中搜索",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_parameter_info",
    description: "获取 procedure 参数的详细信息，包括类型、描述等",
    inputSchema: {
      type: "object",
      properties: {
        procedureName: {
          type: "string",
          description: "Procedure 名称",
        },
        parameterName: {
          type: "string",
          description: "可选，只获取指定参数的信息",
        },
      },
      required: ["procedureName"],
    },
  },
  {
    name: "get_call_graph",
    description: "获取 procedure 的调用关系图，支持递归展开调用链",
    inputSchema: {
      type: "object",
      properties: {
        procedureName: {
          type: "string",
          description: "Procedure 名称，不指定则返回所有 procedure 的调用关系",
        },
        depth: {
          type: "number",
          description: "调用链展开深度，默认 1",
          default: 1,
        },
      },
      required: [],
    },
  },
  {
    name: "get_file_content",
    description: "获取 Hdev 文件的原始 XML 内容",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Hdev 文件路径",
        },
      },
      required: ["filePath"],
    },
  },
];

// ==================== 服务器状态 ====================

class HdevMcpServer {
  private server: Server;
  private index: HdevIndex;
  private parsedFiles: Set<string> = new Set();

  constructor() {
    this.server = new Server(
      {
        name: "hdev-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.index = {
      files: new Map(),
      procedureMap: new Map(),
      callGraph: new Map(),
    };

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const typedArgs = args as unknown;

      try {
        switch (name) {
          case "list_files":
            return await this.handleListFiles(typedArgs as ListFilesArgs);
          case "parse_file":
            return await this.handleParseFile(typedArgs as ParseFileArgs);
          case "list_procedures":
            return await this.handleListProcedures(typedArgs as ListProceduresArgs);
          case "get_procedure":
            return await this.handleGetProcedure(typedArgs as GetProcedureArgs);
          case "search_code":
            return await this.handleSearchCode(typedArgs as SearchCodeArgs);
          case "get_parameter_info":
            return await this.handleGetParameterInfo(typedArgs as GetParameterInfoArgs);
          case "get_call_graph":
            return await this.handleGetCallGraph(typedArgs as GetCallGraphArgs);
          case "get_file_content":
            return await this.handleGetFileContent(typedArgs as { filePath: string });
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // ==================== 工具处理器 ====================

  private async handleListFiles(args: ListFilesArgs): Promise<any> {
    const directory = args.directory || process.cwd();
    const pattern = args.pattern || "*.hdev";

    const files: string[] = [];
    
    try {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        
        if (entry.isDirectory()) {
          // 递归搜索子目录
          const subFiles = this.findHdevFiles(fullPath, pattern);
          files.push(...subFiles);
        } else if (this.matchesPattern(entry.name, pattern)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading directory: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ directory, pattern, files, count: files.length }, null, 2),
        },
      ],
    };
  }

  private findHdevFiles(directory: string, pattern: string): string[] {
    const files: string[] = [];
    
    try {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...this.findHdevFiles(fullPath, pattern));
        } else if (this.matchesPattern(entry.name, pattern)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // 忽略无法访问的目录
    }
    
    return files;
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(filename);
    }
    return filename === pattern;
  }

  private async handleParseFile(args: ParseFileArgs): Promise<any> {
    const { filePath } = args;

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const fileInfo = HdevParser.parseFile(filePath, content);

    // 更新索引
    this.index.files.set(filePath, fileInfo);
    for (const proc of fileInfo.procedures) {
      this.index.procedureMap.set(proc.name, { fileInfo, procedure: proc });
      this.index.callGraph.set(proc.name, proc.calls);
    }
    this.parsedFiles.add(filePath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            filePath: fileInfo.filePath,
            fileVersion: fileInfo.fileVersion,
            halconVersion: fileInfo.halconVersion,
            procedures: fileInfo.procedures.map(p => ({
              name: p.name,
              signature: p.signature,
              paramCount: {
                input_objects: p.parameters.input_objects.length,
                output_objects: p.parameters.output_objects.length,
                input_controls: p.parameters.input_controls.length,
                output_controls: p.parameters.output_controls.length,
              },
              codeLines: p.code.length,
              calls: p.calls,
            })),
          }, null, 2),
        },
      ],
    };
  }

  private async handleListProcedures(args: ListProceduresArgs): Promise<any> {
    let procedures: ProcedureInfo[] = [];

    if (args.filePath) {
      const fileInfo = this.index.files.get(args.filePath);
      if (fileInfo) {
        procedures = fileInfo.procedures;
      } else {
        // 尝试解析文件
        if (fs.existsSync(args.filePath)) {
          const content = fs.readFileSync(args.filePath, "utf-8");
          const fileInfo = HdevParser.parseFile(args.filePath, content);
          this.index.files.set(args.filePath, fileInfo);
          for (const proc of fileInfo.procedures) {
            this.index.procedureMap.set(proc.name, { fileInfo, procedure: proc });
          }
          procedures = fileInfo.procedures;
        }
      }
    } else {
      // 返回所有已解析的 procedures
      for (const [, { procedure }] of this.index.procedureMap) {
        procedures.push(procedure);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            procedures.map(p => ({
              name: p.name,
              signature: p.signature,
              file: p.name,
            })),
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGetProcedure(args: GetProcedureArgs): Promise<any> {
    const { procedureName, format = "json" } = args;

    const entry = this.index.procedureMap.get(procedureName);
    if (!entry) {
      throw new Error(`Procedure not found: ${procedureName}`);
    }

    const { procedure } = entry;

    let output: string;

    if (format === "json") {
      output = JSON.stringify(
        {
          name: procedure.name,
          signature: procedure.signature,
          parameters: procedure.parameters,
          code: procedure.code,
          docu: procedure.docu,
          calls: procedure.calls,
        },
        null,
        2
      );
    } else if (format === "markdown") {
      output = HdevParser.formatProcedureForAI(procedure);
    } else {
      // plain format
      output = `${procedure.name}${procedure.signature}\n\n` +
        procedure.code.map(c => c.line).join("\n");
    }

    return {
      content: [
        {
          type: "text",
          text: output,
        },
      ],
    };
  }

  private async handleSearchCode(args: SearchCodeArgs): Promise<any> {
    const { query, limit = 10, filePath } = args;

    // 如果指定了文件但未解析，先解析
    if (filePath && !this.index.files.has(filePath)) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const fileInfo = HdevParser.parseFile(filePath, content);
        this.index.files.set(filePath, fileInfo);
        for (const proc of fileInfo.procedures) {
          this.index.procedureMap.set(proc.name, { fileInfo, procedure: proc });
        }
      }
    }

    // 如果指定了文件，只在该文件中搜索
    let indexToSearch = this.index;
    if (filePath) {
      const fileInfo = this.index.files.get(filePath);
      if (fileInfo) {
        indexToSearch = {
          files: new Map([[filePath, fileInfo]]),
          procedureMap: new Map(
            Array.from(this.index.procedureMap.entries()).filter(
              ([, { fileInfo: f }]) => f.filePath === filePath
            )
          ),
          callGraph: new Map(
            Array.from(this.index.callGraph.entries()).filter(
              ([name]) => {
                const entry = this.index.procedureMap.get(name);
                return entry?.fileInfo.filePath === filePath;
              }
            )
          ),
        };
      }
    }

    const results = HdevParser.searchProcedure(indexToSearch, query);
    const limitedResults = results.slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              totalResults: results.length,
              returnedResults: limitedResults.length,
              results: limitedResults.map(p => ({
                name: p.name,
                signature: p.signature,
                file: this.index.procedureMap.get(p.name)?.fileInfo.filePath,
                code: p.code.map(c => c.line).join("\n"),
                parameters: p.parameters,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGetParameterInfo(args: GetParameterInfoArgs): Promise<any> {
    const { procedureName, parameterName } = args;

    const entry = this.index.procedureMap.get(procedureName);
    if (!entry) {
      throw new Error(`Procedure not found: ${procedureName}`);
    }

    const { procedure } = entry;
    const allParams = [
      ...procedure.parameters.input_objects,
      ...procedure.parameters.output_objects,
      ...procedure.parameters.input_controls,
      ...procedure.parameters.output_controls,
    ];

    let params = allParams;
    if (parameterName) {
      params = params.filter(p => p.name === parameterName);
      if (params.length === 0) {
        throw new Error(`Parameter not found: ${parameterName}`);
      }
    }

    // 添加文档信息
    const paramsWithDocu = params.map(p => ({
      ...p,
      docu: procedure.docu instanceof Map ? procedure.docu.get(p.name) : undefined,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              procedure: procedureName,
              parameters: paramsWithDocu,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGetCallGraph(args: GetCallGraphArgs): Promise<any> {
    const { procedureName, depth = 1 } = args;

    let callGraph: Record<string, string[]>;

    if (procedureName) {
      // 获取指定 procedure 的调用链
      const chain = HdevParser.getCallChain(this.index, procedureName, new Set());
      callGraph = {
        [procedureName]: this.index.callGraph.get(procedureName) || [],
      };

      // 根据深度展开
      let currentDepth = 1;
      let toExpand = [...(this.index.callGraph.get(procedureName) || [])];
      const expanded = new Set([procedureName]);

      while (currentDepth < depth && toExpand.length > 0) {
        const nextToExpand: string[] = [];
        for (const name of toExpand) {
          if (!expanded.has(name) && this.index.callGraph.has(name)) {
            const calls = this.index.callGraph.get(name)!;
            callGraph[name] = calls;
            nextToExpand.push(...calls);
            expanded.add(name);
          }
        }
        toExpand = nextToExpand;
        currentDepth++;
      }
    } else {
      // 返回所有 procedure 的调用关系
      callGraph = Object.fromEntries(this.index.callGraph);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              procedureName: procedureName || "all",
              depth,
              callGraph,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleGetFileContent(args: { filePath: string }): Promise<any> {
    const { filePath } = args;

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  }

  // ==================== 服务器启动 ====================

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Hdev MCP Server running on stdio");
  }
}

// ==================== 主入口 ====================

const server = new HdevMcpServer();
server.run().catch(console.error);
