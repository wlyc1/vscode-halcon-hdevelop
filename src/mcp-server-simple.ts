/**
 * Hdev MCP Server - Simple Version (without zod)
 * 让 AI 快速且正确地读取 Hdev 代码
 * 
 * 使用方法:
 * 1. 在 Claude Desktop 或其他 MCP 客户端中添加配置
 * 2. 使用 search_hdev_code 工具搜索代码
 * 3. 使用 get_hdev_procedure 工具获取 procedure 详情
 * 4. 使用 list_hdev_files 工具列出所有 Hdev 文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from "fast-xml-parser";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ==================== 类型定义 ====================

interface ProcedureParameter {
  ':@': {
    '@_base_type': string;
    '@_dimension': number;
    '@_name': string;
  };
  par: [];
}

type ProcedureAPI = [
  { io: ProcedureParameter[] },
  { oo: ProcedureParameter[] },
  { ic: ProcedureParameter[] },
  { oc: ProcedureParameter[] }
];

interface TextNode {
  "#text"?: string;
}

interface CommentNode {
  c: TextNode[];
}

interface StatementNode {
  l: TextNode[];
}

type ProcedureBody = (StatementNode | CommentNode)[];

interface ProcedureDocuParameter {
  'parameter': any[];
  ':@': { '@_id': string };
}

type ProcedureDocu = [{ parameters: ProcedureDocuParameter[] }];

interface ProcedureContainer {
  procedure: [
    { interface: ProcedureAPI },
    { body: ProcedureBody },
    { docu: ProcedureDocu }
  ];
  ':@': { '@_name': string };
}

type HDevelopData = ProcedureContainer[];

interface XMLHeader {
  '?xml': [{ '#text': string }];
  ':@': { '@_version': string; '@_encoding': string };
}

type XMLData = [XMLHeader, { hdevelop: HDevelopData }];

export interface ParameterInfo {
  name: string;
  baseType: string;
  dimension: number;
  ioType: 'input_object' | 'output_object' | 'input_control' | 'output_control';
  description?: string;
  defaultValue?: string;
  typeList?: string[];
}

export interface ProcedureInfo {
  name: string;
  signature: string;
  parameters: {
    input_objects: ParameterInfo[];
    output_objects: ParameterInfo[];
    input_controls: ParameterInfo[];
    output_controls: ParameterInfo[];
  };
  code: CodeLine[];
  docu: Record<string, ParameterDocu>;
  calls: string[];
}

export interface CodeLine {
  line: string;
  isComment: boolean;
  lineNumber: number;
}

export interface ParameterDocu {
  description?: string;
  descriptionLang?: string;
  defaultType?: string;
  mixedType?: boolean;
  multiValue?: boolean;
  semType?: string;
  typeList?: string[];
}

export interface HdevFileInfo {
  filePath: string;
  fileVersion?: string;
  halconVersion?: string;
  procedures: ProcedureInfo[];
  procedureMap: Map<string, ProcedureInfo>;
}

export interface HdevIndex {
  files: Map<string, HdevFileInfo>;
  procedureMap: Map<string, { fileInfo: HdevFileInfo; procedure: ProcedureInfo }>;
  callGraph: Map<string, string[]>;
}

// ==================== 解析器实现 ====================

class HdevParser {
  private static readonly parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseAttributeValue: true,
    trimValues: false,
  });

  static parse(xmlContent: string): XMLData {
    const data = this.parser.parse(xmlContent) as XMLData;

    if (data.length < 1 || data[0][":@"] === undefined || data[0][":@"]["@_version"] === undefined) {
      throw new Error("Invalid file: Could not find XML header and version!");
    }

    if (data.length < 2 || data[1].hdevelop === undefined) {
      throw new Error("Invalid file: Could not find hdevelop element!");
    }

    const hdevelopArray = data[1].hdevelop;

    if (!Array.isArray(hdevelopArray)) {
      throw new Error("Invalid file: hdevelop element must be an array!");
    }

    const procedureContainers = hdevelopArray.filter((container: any) => {
      return container.procedure && Array.isArray(container.procedure);
    });

    data[1].hdevelop = procedureContainers;
    return data;
  }

  static extractProcedureInfo(data: XMLData): ProcedureInfo[] {
    const procedures: ProcedureInfo[] = [];
    const hdevelopArray = data[1].hdevelop;

    for (const container of hdevelopArray) {
      const procInfo = this.parseProcedure(container);
      if (procInfo) {
        procedures.push(procInfo);
      }
    }

    return procedures;
  }

  private static parseProcedure(container: any): ProcedureInfo | null {
    const procName = container[":@"]?.["@_name"];
    if (!procName) return null;

    const procParts = container.procedure;
    if (!procParts || !Array.isArray(procParts)) return null;

    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{ io: [] }, { oo: [] }, { ic: [] }, { oc: [] }];

    const bodyPart = procParts.find((p: any) => p.body);
    const body = bodyPart?.body || [];

    const docuPart = procParts.find((p: any) => p.docu);
    const docu = docuPart?.docu;

    const parameters = {
      input_objects: this.parseParameters(api[0]?.io || [], docu, 'input_object'),
      output_objects: this.parseParameters(api[1]?.oo || [], docu, 'output_object'),
      input_controls: this.parseParameters(api[2]?.ic || [], docu, 'input_control'),
      output_controls: this.parseParameters(api[3]?.oc || [], docu, 'output_control'),
    };

    const code = this.parseBody(body);
    const docuMap = this.parseDocu(docu);

    const signature = this.buildSignature(api);

    const calls = this.extractCalls(code);

    return {
      name: procName,
      signature,
      parameters,
      code,
      docu: docuMap,
      calls,
    };
  }

  private static buildSignature(interfaceNodes: any[]): string {
    if (!Array.isArray(interfaceNodes) || interfaceNodes.length === 0) {
      return "()";
    }

    const parts: string[] = [];

    for (const section of interfaceNodes) {
      const sectionKey = (["io", "oo", "ic", "oc"] as const).find((key) => Array.isArray(section?.[key]));
      if (!sectionKey) {
        continue;
      }

      const direction = sectionKey === "io" || sectionKey === "ic" ? "INPUT" : "OUTPUT";

      for (const param of section[sectionKey] as ProcedureParameter[]) {
        const paramData = param?.[":@"];
        const name = paramData?.["@_name"];
        if (!name) {
          continue;
        }

        const baseType = paramData?.["@_base_type"] || "ctrl";
        const dimension = Number(paramData?.["@_dimension"] || 0);
        const dimensionSuffix = dimension > 0 ? `[${dimension}]` : "";
        parts.push(`[${direction}] ${baseType} ${name}${dimensionSuffix}`);
      }
    }

    return `(${parts.join(", ")})`;
  }

  private static parseParameters(
    params: ProcedureParameter[],
    docu: ProcedureDocu | undefined,
    ioType: ParameterInfo['ioType']
  ): ParameterInfo[] {
    const docuMap = this.parseDocu(docu);
    const result: ParameterInfo[] = [];

    for (const param of params) {
      const paramData = param[":@"];
      if (!paramData) continue;

      const name = paramData["@_name"] || "";
      if (!name) continue;

      const docuInfo = docuMap.get(name);
      result.push({
        name,
        baseType: paramData["@_base_type"] || "ctrl",
        dimension: paramData["@_dimension"] || 0,
        ioType,
        description: docuInfo?.description,
        typeList: docuInfo?.typeList,
        defaultValue: undefined,
      });
    }

    return result;
  }

  private static parseDocu(docu: ProcedureDocu | undefined): Map<string, ParameterDocu> {
    const map = new Map<string, ParameterDocu>();

    if (!docu || !Array.isArray(docu)) {
      return map;
    }

    const docuElement = docu[0] as any;
    if (!docuElement?.parameters || !Array.isArray(docuElement.parameters)) {
      return map;
    }

    for (const param of docuElement.parameters) {
      const paramId = param?.[":@"]?.["@_id"];
      if (!paramId) continue;

      const paramChildren = param?.parameter;
      if (!Array.isArray(paramChildren)) continue;

      const docuInfo: ParameterDocu = {};

      for (const child of paramChildren) {
        if (child?.description) {
          const descArray = child.description;
          if (Array.isArray(descArray) && descArray.length > 0) {
            const descElement = descArray[0];
            if (descElement?.["#text"]) {
              docuInfo.description = descElement["#text"];
            }
            if (descElement[":@"]?.["@_lang"]) {
              docuInfo.descriptionLang = descElement[":@"]["@_lang"];
            }
          }
        }
        if (child?.default_type?.[0]?.["#text"]) {
          docuInfo.defaultType = child.default_type[0]["#text"];
        }
        if (child?.mixed_type?.[0]?.["#text"]) {
          docuInfo.mixedType = child.mixed_type[0]["#text"] === "true";
        }
        if (child?.multivalue?.[0]?.["#text"]) {
          docuInfo.multiValue = child.multivalue[0]["#text"] === "true";
        }
        if (child?.sem_type?.[0]?.["#text"]) {
          docuInfo.semType = child.sem_type[0]["#text"];
        }
        if (child?.type_list) {
          const typeListArray = child.type_list;
          if (Array.isArray(typeListArray)) {
            docuInfo.typeList = typeListArray
              .filter((item: any) => item?.item?.[0]?.["#text"])
              .map((item: any) => item.item[0]["#text"]);
          }
        }
      }

      map.set(paramId, docuInfo);
    }

    return map;
  }

  static parseBody(body: ProcedureBody): CodeLine[] {
    const lines: CodeLine[] = [];
    let lineNumber = 1;

    for (const node of body) {
      if ("l" in node) {
        if (Array.isArray(node.l) && node.l.length > 0) {
          const lNode = node.l[0];
          if (lNode && typeof lNode === 'object' && "#text" in lNode) {
            const text = lNode["#text"] || "";
            if (text.trim().length > 0) {
              lines.push({
                line: text,
                isComment: false,
                lineNumber: lineNumber++,
              });
            }
          }
        }
      } else if ("c" in node) {
        if (Array.isArray(node.c) && node.c.length > 0) {
          const cNode = node.c[0];
          if (cNode && typeof cNode === 'object' && "#text" in cNode) {
            const text = cNode["#text"] || "";
            if (text.trim().length > 0) {
              lines.push({
                line: text,
                isComment: true,
                lineNumber: lineNumber++,
              });
            }
          }
        }
      }
    }

    return lines;
  }

  static extractCalls(code: CodeLine[]): string[] {
    const calls = new Set<string>();
    
    const builtInKeywords = new Set([
      'if', 'else', 'endif', 'while', 'endwhile', 'for', 'to', 'by', 'endfor',
      'try', 'catch', 'endtry', 'return', 'exit',
      'dev_update_off', 'dev_update_on', 'dev_close_window', 'dev_open_window',
      'dev_set_draw', 'dev_set_line_width', 'dev_set_color', 'dev_set_font',
      'dev_display', 'dev_clear_window', 'dev_set_shape', 'dev_set_colored',
      'read_image', 'read_region', 'dev_set_window',
      'tuple_gen_range', 'tuple_length', 'tuple_select', 'tuple_concat',
      'count_seconds', 'relative_time', 'str', 'sprintf',
      'file_exists', 'open_file', 'close_file', 'fwrite_string', 'fread_line',
      'open_folder', 'close_folder', 'list_folder', 'create_dir', 'remove_file',
      'open_framegrabber', 'close_framegrabber', 'grab_image', 'grab_image_start',
      'get_window_extents', 'set_window_extents', 'get_mbutton', 'get_hposition',
      'gen_empty_obj', 'concat_obj', 'select_obj', 'count_obj',
      'get_obj', 'get_image_size', 'get_image_type', 'get_image_pointer1',
      'threshold', 'connection', 'select_shape', 'area_center', 'orientation_region',
      'shape_trans', 'fill_up', 'opening_circle', 'closing_circle', 'dilation_circle',
      'erosion_circle', 'opening_rectangle', 'closing_rectangle',
      'binary_threshold', 'dyn_threshold', 'var_threshold', 'scale_image',
      'gauss_image', 'mean_image', 'median_image', 'sobel_amp', 'laplace',
      'edges_sub_pix', 'lines_gauss', 'circles_gauss', 'color_trans',
      'rgb1_to_gray', 'decompose3', 'compose3', 'trans_from_rgb', 'trans_to_rgb',
      'create_shape_model', 'create_scaled_shape_model', 'create_aniso_shape_model',
      'find_shape_model', 'find_scaled_shape_model', 'clear_shape_model',
      'create_template', 'find_template',
      'hom_mat2d_identity', 'hom_mat2d_translate', 'hom_mat2d_rotate', 'hom_mat2d_scale',
      'hom_mat2d_affine_trans', 'affine_trans_image', 'projective_trans_image',
      'hom_vector_to_proj_hom_mat2d',
      'distance_pp', 'angle_ll', 'line_position', 'intersection_lines',
      'union1', 'union2', 'intersection', 'difference', 'complement',
      'select_shape', 'select_shape_std', 'select_shape_transformed',
      'smallest_rectangle1', 'smallest_rectangle2', 'smallest_circle',
      'gen_rectangle1', 'gen_rectangle2', 'gen_circle', 'gen_ellipse', 'gen_contour_polygon_xld',
      'reduce_domain', 'crop_domain', 'zoom_image_factor', 'scale_image',
      'equ_histo_image', 'emphasize', 'invert_image', 'pow_image',
      'bandpass_image', 'fft_generic', 'rft_generic',
      'disp_continue', 'disp_message', 'disp_ellipse', 'disp_rectangle',
      'disp_circle', 'disp_line', 'disp_continue', 'set_tposition', 'write_string',
      'open_window', 'close_window', 'dev_update_var', 'dev_update_proc',
      'set_system', 'get_system', 'get_param', 'set_param',
      'query_framegrabber_devices', 'get_framegrabber_param', 'set_framegrabber_param',
      'serial_open', 'serial_close', 'serial_write', 'serial_read',
      'open_network', 'close_network', 'socket_receive', 'socket_send',
      'abs', 'sqrt', 'exp', 'log', 'sin', 'cos', 'tan', 'atan', 'asin', 'acos',
      'round', 'int', 'floor', 'ceil', 'min', 'max', 'mod', 'sign',
      'tuple_abs', 'tuple_sqrt', 'tuple_exp', 'tuple_log', 'tuple_sin', 'tuple_cos',
      'tuple_round', 'tuple_int', 'tuple_floor', 'tuple_ceil', 'tuple_min', 'tuple_max',
      'strlen', 'substr', 'strrchr', 'strcmp', 'stringlower', 'stringupper',
      'tuple_string', 'tuple_number',
      'clear_obj', 'gen_empty_region', 'gen_region', 'clip_region',
      'move_region', 'rotate_region', 'scale_region', 'mirror_region',
      'boundary', 'skeleton', 'convexity', 'select_region',
    ]);

    const procedureCallPattern = /(\w+)\s*\(/g;

    for (const codeLine of code) {
      if (codeLine.isComment) continue;

      let match;
      while ((match = procedureCallPattern.exec(codeLine.line)) !== null) {
        const procName = match[1];
        
        if (procName && !builtInKeywords.has(procName.toLowerCase())) {
          if (!/^[a-z]$/i.test(procName) && !/^\d/.test(procName)) {
            calls.add(procName);
          }
        }
      }
    }

    return Array.from(calls);
  }

  static parseFile(filePath: string, xmlContent: string): HdevFileInfo {
    const data = this.parse(xmlContent);
    const procedures = this.extractProcedureInfo(data);
    const procedureMap = new Map<string, ProcedureInfo>();

    for (const proc of procedures) {
      procedureMap.set(proc.name, proc);
    }

    const hdevelopElement = data[1];
    const fileVersion = (hdevelopElement as any)?.[':@']?.['@_file_version'] || 
                        (hdevelopElement as any)?.file_version;
    const halconVersion = (hdevelopElement as any)?.[':@']?.['@_halcon_version'] || 
                          (hdevelopElement as any)?.halcon_version;

    return {
      filePath,
      fileVersion,
      halconVersion,
      procedures,
      procedureMap,
    };
  }

  static buildIndex(files: HdevFileInfo[]): HdevIndex {
    const index: HdevIndex = {
      files: new Map(),
      procedureMap: new Map(),
      callGraph: new Map(),
    };

    for (const file of files) {
      index.files.set(file.filePath, file);

      for (const proc of file.procedures) {
        index.procedureMap.set(proc.name, { fileInfo: file, procedure: proc });
        index.callGraph.set(proc.name, proc.calls);
      }
    }

    return index;
  }

  static searchProcedure(index: HdevIndex, query: string): ProcedureInfo[] {
    const results: ProcedureInfo[] = [];
    const queryLower = query.toLowerCase();

    for (const [name, { procedure }] of index.procedureMap) {
      if (name.toLowerCase().includes(queryLower)) {
        results.push(procedure);
        continue;
      }

      for (const codeLine of procedure.code) {
        if (codeLine.line.toLowerCase().includes(queryLower)) {
          results.push(procedure);
          break;
        }
      }

      const allParams = [
        ...procedure.parameters.input_objects,
        ...procedure.parameters.output_objects,
        ...procedure.parameters.input_controls,
        ...procedure.parameters.output_controls,
      ];
      for (const param of allParams) {
        if (param.name.toLowerCase().includes(queryLower)) {
          results.push(procedure);
          break;
        }
        if (param.description?.toLowerCase().includes(queryLower)) {
          results.push(procedure);
          break;
        }
      }
    }

    return results;
  }

  static formatProcedureForAI(proc: ProcedureInfo): string {
    const lines: string[] = [];

    lines.push(`## Procedure: ${proc.name}${proc.signature}`);
    lines.push("");

    const allParams = [
      ...proc.parameters.input_objects.map(p => ({ ...p, ioType: 'INPUT_OBJECT' as const })),
      ...proc.parameters.output_objects.map(p => ({ ...p, ioType: 'OUTPUT_OBJECT' as const })),
      ...proc.parameters.input_controls.map(p => ({ ...p, ioType: 'INPUT_CONTROL' as const })),
      ...proc.parameters.output_controls.map(p => ({ ...p, ioType: 'OUTPUT_CONTROL' as const })),
    ];

    if (allParams.length > 0) {
      lines.push("### Parameters:");
      for (const param of allParams) {
        const dimSuffix = param.dimension > 0 ? `[${param.dimension}]` : "";
        const desc = param.description ? ` - ${param.description}` : "";
        lines.push(`- [${param.ioType}] ${param.baseType} ${param.name}${dimSuffix}${desc}`);
      }
      lines.push("");
    }

    lines.push("### Code:");
    lines.push("```hdevelop");
    for (const codeLine of proc.code) {
      lines.push(codeLine.line);
    }
    lines.push("```");
    lines.push("");

    if (proc.calls.length > 0) {
      lines.push(`### Calls: ${proc.calls.join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  static formatFileForAI(fileInfo: HdevFileInfo): string {
    const lines: string[] = [];

    lines.push(`# Hdev File: ${fileInfo.filePath}`);
    if (fileInfo.halconVersion) {
      lines.push(`Halcon Version: ${fileInfo.halconVersion}`);
    }
    lines.push("");

    for (const proc of fileInfo.procedures) {
      lines.push(this.formatProcedureForAI(proc));
    }

    return lines.join("\n");
  }
}

// ==================== MCP Server 实现 ====================

class HdevMCPServer {
  private server: Server;
  private index: HdevIndex | null = null;
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    
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

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "list_hdev_files",
            description: "列出工作空间中所有的 Hdev 文件",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
          },
          {
            name: "get_hdev_file",
            description: "获取指定 Hdev 文件的内容（AI 友好格式）",
            inputSchema: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Hdev 文件的路径",
                },
              },
              required: ["filePath"],
            },
          },
          {
            name: "get_hdev_procedure",
            description: "获取指定 Procedure 的详细信息",
            inputSchema: {
              type: "object",
              properties: {
                procedureName: {
                  type: "string",
                  description: "Procedure 名称",
                },
              },
              required: ["procedureName"],
            },
          },
          {
            name: "search_hdev_code",
            description: "在 Hdev 代码中搜索关键字（支持名称、代码内容、参数名）",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "搜索关键字",
                },
                limit: {
                  type: "number",
                  description: "最大返回结果数量",
                  default: 10,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "get_hdev_call_graph",
            description: "获取指定 Procedure 的调用链",
            inputSchema: {
              type: "object",
              properties: {
                procedureName: {
                  type: "string",
                  description: "Procedure 名称",
                },
              },
              required: ["procedureName"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (!this.index) {
          await this.buildIndex();
        }

        switch (name) {
          case "list_hdev_files":
            return await this.listHdevFiles();
          
          case "get_hdev_file":
            return await this.getHdevFile(args as { filePath: string });
          
          case "get_hdev_procedure":
            return await this.getHdevProcedure(args as { procedureName: string });
          
          case "search_hdev_code":
            return await this.searchHdevCode(args as { query: string; limit?: number });
          
          case "get_hdev_call_graph":
            return await this.getHdevCallGraph(args as { procedureName: string });
          
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
        };
      }
    });
  }

  private async buildIndex() {
    const hdevFiles = await this.findHdevFiles(this.workspacePath);
    const fileInfos: HdevFileInfo[] = [];

    for (const filePath of hdevFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileInfo = HdevParser.parseFile(filePath, content);
        fileInfos.push(fileInfo);
      } catch (error) {
        console.error(`Error parsing ${filePath}:`, error);
      }
    }

    this.index = HdevParser.buildIndex(fileInfos);
  }

  private async findHdevFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    
    const scan = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.hdev')) {
          results.push(fullPath);
        }
      }
    };

    scan(dir);
    return results;
  }

  private async listHdevFiles() {
    if (!this.index) {
      return {
        content: [
          {
            type: "text",
            text: "No Hdev files found. Please make sure you have Hdev files in your workspace.",
          },
        ],
      };
    }

    const files = Array.from(this.index.files.values()).map(f => ({
      path: f.filePath,
      procedures: f.procedures.map(p => p.name),
      halconVersion: f.halconVersion,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(files, null, 2),
        },
      ],
    };
  }

  private async getHdevFile(args: { filePath: string }) {
    if (!this.index) {
      throw new Error("Index not built. Please try again.");
    }

    const fileInfo = this.index.files.get(args.filePath);
    if (!fileInfo) {
      throw new Error(`File not found: ${args.filePath}`);
    }

    const content = HdevParser.formatFileForAI(fileInfo);

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  }

  private async getHdevProcedure(args: { procedureName: string }) {
    if (!this.index) {
      throw new Error("Index not built. Please try again.");
    }

    const entry = this.index.procedureMap.get(args.procedureName);
    if (!entry) {
      throw new Error(`Procedure not found: ${args.procedureName}`);
    }

    const content = HdevParser.formatProcedureForAI(entry.procedure);

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  }

  private async searchHdevCode(args: { query: string; limit?: number }) {
    if (!this.index) {
      throw new Error("Index not built. Please try again.");
    }

    const limit = args.limit || 10;
    const results = HdevParser.searchProcedure(this.index, args.query);
    const limited = results.slice(0, limit);

    const formatted = limited.map(proc => {
      const fileInfo = Array.from(this.index!.files.values()).find(f => 
        f.procedures.some(p => p.name === proc.name)
      );
      return {
        procedure: proc.name,
        file: fileInfo?.filePath,
        signature: proc.signature,
        calls: proc.calls,
        preview: proc.code.slice(0, 5).map(c => c.line).join('\n'),
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    };
  }

  private async getHdevCallGraph(args: { procedureName: string }) {
    if (!this.index) {
      throw new Error("Index not built. Please try again.");
    }

    const calls = this.index.callGraph.get(args.procedureName) || [];
    const fullChain = this.getCallChain(args.procedureName);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            procedure: args.procedureName,
            directCalls: calls,
            fullChain: fullChain,
          }, null, 2),
        },
      ],
    };
  }

  private getCallChain(procedureName: string, visited = new Set<string>()): string[] {
    if (!this.index) return [];
    
    if (visited.has(procedureName)) {
      return [];
    }
    visited.add(procedureName);

    const calls = this.index.callGraph.get(procedureName) || [];
    const chain: string[] = [...calls];

    for (const call of calls) {
      if (this.index.procedureMap.has(call)) {
        chain.push(...this.getCallChain(call, visited));
      }
    }

    return chain;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Hdev MCP Server running on stdio");
  }
}

// ==================== 主程序 ====================

const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
const server = new HdevMCPServer(workspacePath);
server.run().catch(console.error);
