/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { HDevelopFormatter } from "./HDevelopFormatter";

interface ProcedureParameter {
  ':@': {'@_base_type': string, '@_dimension': number; '@_name': string};
  par: [];
}

type ProcedureAPI = [
  {io: ProcedureParameter[]},
  {oo: ProcedureParameter[]},
  {ic: ProcedureParameter[]},
  {oc: ProcedureParameter[]}
];

type TextNode = [{ "#text"?: string }];

interface CommentNode {
  c: TextNode;
}

interface StatementNode {
  l: TextNode;
}

type ProcedureBody = (StatementNode | CommentNode)[];

interface ProcedureDocuParameter {
  'parameter': any[];
  ':@': {'@_id': string};
}

type ProcedureDocu = [{parameters: ProcedureDocuParameter[]}];

// Original XML structure preserved
interface ProcedureContainer {
  procedure: [
    {interface: ProcedureAPI},
    {body: ProcedureBody},
    {docu: ProcedureDocu}
  ];
  ':@': {'@_name': string};
}

type HDevelopData = ProcedureContainer[];

type XMLHeader = {
  '?xml': [{'#text': string}],
  ':@': {'@_version': string, '@_encoding': string}
};

type XMLData = [XMLHeader, {hdevelop: HDevelopData}];

interface HDevelopNotebookMetadata {
  originalContent: XMLData;
  selectedProcedure?: string;
}

interface HDevelopNotebookData extends vscode.NotebookData {
  metadata: HDevelopNotebookMetadata;
}

export class HDevelopSerializer implements vscode.NotebookSerializer {
  private static readonly parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseAttributeValue: true,
    trimValues: false,
  });
  private static readonly serializer = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
    textNodeName: '#text',
  });
  private static readonly textDecoder = new TextDecoder();
  private static readonly textEncoder = new TextEncoder();
  private static readonly formatter = new HDevelopFormatter();

  private static parseData(fileContent: Uint8Array): XMLData {
    console.log('[halcon-hdevelop] 开始解析 HDevelop XML 文件');
    
    const decodedContent = HDevelopSerializer.textDecoder.decode(fileContent);
    console.log('[halcon-hdevelop] XML 内容长度:', decodedContent.length);
    
    let data: XMLData;
    try {
      data = HDevelopSerializer.parser.parse(decodedContent) as XMLData;
      console.log('[halcon-hdevelop] XML 解析成功');

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
      
      // 过滤掉非 procedure 元素（如#text 节点）
      const procedureContainers = hdevelopArray.filter((container: any) => {
        return container.procedure && Array.isArray(container.procedure);
      });
      
      console.log('[halcon-hdevelop] 检测到 procedure 数量:', procedureContainers.length);
      
      // Normalize each procedure to ensure consistent structure
      procedureContainers.forEach((container: any, index: number) => {
        const procName = container[":@"]?.["@_name"] || `procedure_${index}`;
        let procParts = container.procedure;
        
        // 检查 procParts 是否存在
        if (!procParts) {
          console.log(`[halcon-hdevelop] procedure_${index} 没有 procedure 元素，创建默认结构`);
          container.procedure = [];
          procParts = container.procedure;
        }
        
        if (!Array.isArray(procParts)) {
          container.procedure = [];
          procParts = container.procedure;
        }
        
        // Ensure interface exists with proper structure
        let interfacePart = procParts.find((p: any) => p.interface);
        if (!interfacePart) {
          interfacePart = { interface: [{io: []}, {oo: []}, {ic: []}, {oc: []}] };
          procParts.push(interfacePart);
        } else {
          // Ensure interface array has all four sections
          const api = interfacePart.interface as any[];
          if (!Array.isArray(api)) {
            interfacePart.interface = [{io: []}, {oo: []}, {ic: []}, {oc: []}];
          } else {
            // Check for each section and add if missing
            const hasIO = api.some(item => item.io);
            const hasOO = api.some(item => item.oo);
            const hasIC = api.some(item => item.ic);
            const hasOC = api.some(item => item.oc);
            
            if (!hasIO) api.push({io: []});
            if (!hasOO) api.push({oo: []});
            if (!hasIC) api.push({ic: []});
            if (!hasOC) api.push({oc: []});
          }
        }
        
        // Ensure body exists
        let bodyPart = procParts.find((p: any) => p.body);
        if (!bodyPart) {
          bodyPart = { body: [] };
          procParts.push(bodyPart);
        }
        
        // Ensure docu exists
        let docuPart = procParts.find((p: any) => p.docu);
        if (!docuPart) {
          docuPart = { docu: [{ parameters: [] }] };
          procParts.push(docuPart);
        } else {
          // Ensure docu id is set
          const docuElement = docuPart.docu?.[0];
          if (docuElement) {
            if (!docuElement[":@"]) {
              docuElement[":@"] = { "@_id": procName };
            } else {
              docuElement[":@"]["@_id"] = procName;
            }
          }
        }
        
        console.log(`[halcon-hdevelop] 标准化 procedure: ${procName}`);
      });

      data[0][":@"]["@_version"] = "1.0";
      // 更新 hdevelop 数组为过滤后的结果
      data[1].hdevelop = procedureContainers;
      console.log('[halcon-hdevelop] XML 文件解析完成');
      
      return data;
    } catch (error) {
      console.error('[halcon-hdevelop] XML 解析错误:', error);
      console.error('[halcon-hdevelop] 错误堆栈:', (error as Error).stack);
      throw error;
    }
  }

  private deserializeBody(body: ProcedureBody): string {
    const lines: string[] = [];
    
    for (const node of body) {
      try {
        if ("l" in node) {
          // 代码行
          if (Array.isArray(node.l) && node.l.length > 0) {
            const lNode = node.l[0];
            if (lNode && typeof lNode === 'object' && "#text" in lNode) {
              const text = lNode["#text"] || "";
              // 只添加非空行
              if (text.length > 0) {
                lines.push(text);
              }
            }
          }
        } else if ("c" in node) {
          // 注释行
          if (Array.isArray(node.c) && node.c.length > 0) {
            const cNode = node.c[0];
            if (cNode && typeof cNode === 'object' && "#text" in cNode) {
              const text = cNode["#text"] || "";
              // 只添加非空注释行
              if (text.length > 0) {
                lines.push(text);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[halcon-hdevelop] 处理节点时出错:`, error);
      }
    }
    
    return lines.join("\n");
  }

  private deserializeCodeCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const bodyPart = procParts.find((p: any) => p.body);
    const body = bodyPart?.body || [];
    const codeCellData = this.deserializeBody(body);

    return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, codeCellData, 'hdevelop');
  }

  private static extractParameterDescriptions(docu: ProcedureDocu | undefined): Map<string, string> {
    const descriptions = new Map<string, string>();
    
    if (!docu || !Array.isArray(docu)) {
      return descriptions;
    }
    
    const docuElement = docu[0] as any;
    if (!docuElement?.parameters || !Array.isArray(docuElement.parameters)) {
      return descriptions;
    }
    
    for (const param of docuElement.parameters) {
      try {
        const paramId = param?.[":@"]?.["@_id"];
        if (!paramId) continue;
        
        const paramChildren = param?.parameter;
        if (!Array.isArray(paramChildren)) continue;
        
        let description = '';
        for (const child of paramChildren) {
          if (child?.description) {
            const descArray = child.description;
            if (Array.isArray(descArray) && descArray.length > 0) {
              const descElement = descArray[0];
              if (descElement?.["#text"]) {
                description = descElement["#text"];
              }
            }
          }
        }
        
        if (description) {
          descriptions.set(paramId, description);
        }
      } catch (error) {
        console.error('[halcon-hdevelop] 提取参数描述时出错:', error);
      }
    }
    
    return descriptions;
  }

  private static deserializeAPIParameters(
    parameters: ProcedureParameter[], 
    descriptions: Map<string, string> = new Map(),
    ioType?: 'input' | 'output'
  ): string {
    if (!parameters || parameters.length === 0) {
      return '';
    }
    
    const lines = parameters.map((parameter) => {
      try {
        const paramData = parameter[":@"];
        if (!paramData) {
          return '';
        }
        const baseType = paramData["@_base_type"] || 'ctrl';
        const dimension = paramData["@_dimension"] || 0;
        const name = paramData["@_name"] || '';
        
        if (!name) {
          return '';
        }

        const dimensionSuffix = (dimension !== 0) ? `[${dimension}]` : '';
        const ioStatusPrefix = ioType ? `[${ioType === 'input' ? 'INPUT' : 'OUTPUT'}] ` : '';

        const description = descriptions.get(name) || '';
        const descriptionComment = description ? `  // ${description}` : '';

        return `${ioStatusPrefix}${baseType} ${name}${dimensionSuffix}${descriptionComment}`;
      } catch (error) {
        console.error('[halcon-hdevelop] 反序列化 API 参数时出错:', error);
        return '';
      }
    });
    
    const result = lines.filter(line => line.length > 0).join('\n');
    console.log('[halcon-hdevelop] deserializeAPIParameters 结果:', result);
    return result;
  }

  private static extractParametersFromSection(
    api: ProcedureAPI,
    section: 'io' | 'oo' | 'ic' | 'oc'
  ): ProcedureParameter[] {
    if (!api || !Array.isArray(api)) {
      return [];
    }
    
    for (const item of api) {
      if (section in item) {
        return (item as any)[section];
      }
    }
    return [];
  }

  private deserializeInputObjectCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{io: []}, {oo: []}, {ic: []}, {oc: []}];
    const inputObjects = HDevelopSerializer.extractParametersFromSection(api, 'io');
    const docuPart = procParts.find((p: any) => p.docu);
    const descriptions = HDevelopSerializer.extractParameterDescriptions(docuPart?.docu);
    const code = HDevelopSerializer.deserializeAPIParameters(inputObjects, descriptions);

    return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api')
  }

  private deserializeOutputObjectCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{io: []}, {oo: []}, {ic: []}, {oc: []}];
    const outputObjects = HDevelopSerializer.extractParametersFromSection(api, 'oo');
    const docuPart = procParts.find((p: any) => p.docu);
    const descriptions = HDevelopSerializer.extractParameterDescriptions(docuPart?.docu);
    const code = HDevelopSerializer.deserializeAPIParameters(outputObjects, descriptions);

    return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api')
  }

  private deserializeInputControlCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{io: []}, {oo: []}, {ic: []}, {oc: []}];
    const inputControls = HDevelopSerializer.extractParametersFromSection(api, 'ic');
    const docuPart = procParts.find((p: any) => p.docu);
    const descriptions = HDevelopSerializer.extractParameterDescriptions(docuPart?.docu);
    const code = HDevelopSerializer.deserializeAPIParameters(inputControls, descriptions, 'input');

    console.log('[halcon-hdevelop] deserializeInputControlCell - inputControls:', inputControls);
    console.log('[halcon-hdevelop] deserializeInputControlCell - code:', code);

    return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api')
  }

  private deserializeOutputControlCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{io: []}, {oo: []}, {ic: []}, {oc: []}];
    const outputControls = HDevelopSerializer.extractParametersFromSection(api, 'oc');
    const docuPart = procParts.find((p: any) => p.docu);
    const descriptions = HDevelopSerializer.extractParameterDescriptions(docuPart?.docu);
    const code = HDevelopSerializer.deserializeAPIParameters(outputControls, descriptions, 'output');

    return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api')
  }

  async deserializeNotebook(
    content: Uint8Array,
    token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    try {
      const hdevelopData = HDevelopSerializer.parseData(content);
      const procedures = hdevelopData[1].hdevelop;

      const cells: vscode.NotebookCellData[] = [];

      cells.push(new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        '# Halcon HDevelop Procedures\n\nSelect a procedure from the list above to view its code.',
        'markdown'
      ));

    const buildProcedureSignature = (proc: any): string => {
      try {
        const procParts = proc.procedure;
        const interfacePart = procParts.find((p: any) => p.interface);
        const api = interfacePart?.interface;
        if (!api) {
          return "()";
        }
        
        const params: string[] = [];
        
        const extractParamNames = (section: 'io' | 'ic'): void => {
          for (const item of api) {
            if (item && item[section] && Array.isArray(item[section])) {
              item[section].forEach((param: any) => {
                if (param?.[":@"]?.["@_name"]) {
                  params.push(param[":@"]["@_name"]);
                }
              });
            }
          }
        };
        
        extractParamNames('io');
        extractParamNames('ic');
        
        return `(${params.join(", ")})`;
      } catch (error) {
        console.error('[halcon-hdevelop] 构建函数签名时出错:', error);
        return "()";
      }
    };
    
    procedures.forEach((procedure: any, index: number) => {
      try {
        const procedureName = procedure[":@"]?.["@_name"] || `procedure_${index}`;
        
        // 检查 procedure 是否有实际内容
        const procParts = procedure.procedure;
        if (!procParts || !Array.isArray(procParts)) {
          console.log(`[halcon-hdevelop] 跳过空的 procedure: ${procedureName}`);
          return;
        }
        
        const bodyPart = procParts.find((p: any) => p.body);
        const body = bodyPart?.body || [];
        
        // 检查 body 是否为空
        if (body.length === 0) {
          console.log(`[halcon-hdevelop] 跳过没有 body 内容的 procedure: ${procedureName}`);
          return;
        }
        
        // 检查 body 是否只包含空行或空注释
        const hasActualContent = body.some((node: any) => {
          if ("l" in node) {
            // 代码行
            const textNode = node.l?.[0];
            const text = textNode?.["#text"] || "";
            return text.trim().length > 0;
          } else if ("c" in node) {
            // 注释行 - 只有非空注释才算内容
            const textNode = node.c?.[0];
            const text = textNode?.["#text"] || "";
            return text.trim().length > 0;
          }
          return false;
        });
        
        if (!hasActualContent) {
          console.log(`[halcon-hdevelop] 跳过没有实际代码的 procedure: ${procedureName}`);
          return;
        }
        
        const signature = buildProcedureSignature(procedure);
        
        cells.push(new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          `### ${procedureName}${signature}`,
          'markdown'
        ));

        const procedureData: XMLData = [
          hdevelopData[0],
          { hdevelop: [procedure] }
        ];

        const inputObjectsCell = this.deserializeInputObjectCell(procedureData);
        const outputObjectsCell = this.deserializeOutputObjectCell(procedureData);
        const inputControlsCell = this.deserializeInputControlCell(procedureData);
        const outputControlsCell = this.deserializeOutputControlCell(procedureData);
        const codeCell = this.deserializeCodeCell(procedureData);
        
        if (inputObjectsCell.value.trim()) {
          cells.push(inputObjectsCell);
        }
        if (outputObjectsCell.value.trim()) {
          cells.push(outputObjectsCell);
        }
        if (inputControlsCell.value.trim()) {
          cells.push(inputControlsCell);
        }
        if (outputControlsCell.value.trim()) {
          cells.push(outputControlsCell);
        }
        cells.push(codeCell);
      } catch (error) {
        console.error(`[halcon-hdevelop] 处理 procedure ${index}时出错:`, error);
        cells.push(new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          `## 错误：处理 procedure ${index}时出错\n\n${error instanceof Error ? error.message : String(error)}`,
          'markdown'
        ));
      }
    });

    const data = new vscode.NotebookData(cells) as HDevelopNotebookData;
    const firstProc = procedures[0] as any;
    data.metadata = { 
      originalContent: hdevelopData,
      selectedProcedure: procedures.length > 0 ? firstProc[":@"]?.["@_name"] : undefined
    };

    return data;
    } catch (error) {
      console.error('[halcon-hdevelop] 反序列化笔记本时出错:', error);
      console.error('[halcon-hdevelop] 错误堆栈:', error instanceof Error ? error.stack : undefined);
      
      const errorCells: vscode.NotebookCellData[] = [
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          `# 解析错误\n\n无法解析 HDevelop 文件:\n\n**错误信息**: ${error instanceof Error ? error.message : String(error)}\n\n**建议**: 检查文件格式是否正确，或尝试以文本编辑器打开修复文件。`,
          'markdown'
        )
      ];
      
      const data = new vscode.NotebookData(errorCells) as HDevelopNotebookData;
      data.metadata = { 
        originalContent: null as any,
        selectedProcedure: undefined
      };
      
      return data;
    }
  }

  private static serializeCodeCell(cell: vscode.NotebookCellData): ProcedureBody {
    const body: ProcedureBody = [];
    for (const line of cell.value.split('\n')) {
      // 跳过空行
      if (line.length === 0) {
        continue;
      }
      // 注释行以 * 开头
      if (line.startsWith('*')) {
        body.push({c: [{'#text': line}]});
      } else {
        body.push({l: [{'#text': line}]});
      }
    }
    return body;
  }

  private static serializeAPIParameters(cell: vscode.NotebookCellData): ProcedureParameter[] {
    const parameters: ProcedureParameter[] = [];
    
    for (const line of cell.value.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      
      const lineWithoutComment = line.split('//')[0].trim();
      
      if (!lineWithoutComment) {
        continue;
      }
      
      const lineWithoutPrefix = lineWithoutComment.replace(/^\[(INPUT|OUTPUT)\]\s*/, '');
      
      const groups = lineWithoutPrefix.match("^\\s*(iconic|ctrl)\\s+([$_a-zA-Z][$_a-zA-Z0-9]*)\\s*(?:\\[(\\d+)\\])?\\s*$")

      if (groups === null) {
        console.log('[halcon-hdevelop] 跳过不匹配的行:', line);
        continue;
      }

      const [_, baseType, name, dimension] = groups;
      const dimensionCount = dimension !== undefined ? Number(dimension) : 0;

      parameters.push({":@": {"@_base_type": baseType, "@_dimension": dimensionCount, "@_name": name}, par: []});
    }
    
    return parameters;
  }

  private static getAPIParameterNames(api: ProcedureAPI): string[] {
    return [
      ...api[0].io.map((parameter) => parameter[":@"]["@_name"]),
      ...api[1].oo.map((parameter) => parameter[":@"]["@_name"]),
      ...api[2].ic.map((parameter) => parameter[":@"]["@_name"]),
      ...api[3].oc.map((parameter) => parameter[":@"]["@_name"]),
    ];
  }

  private static generateDocu(api: ProcedureAPI): ProcedureDocu {
    const parameterNames = HDevelopSerializer.getAPIParameterNames(api).sort();

    return [{
      parameters: parameterNames.map(name => ({":@": {"@_id": name}, parameter: []}))
    }];
  }
 
  serializeNotebook(
    data: HDevelopNotebookData,
    token: vscode.CancellationToken
  ): Uint8Array {
    const content = data.metadata.originalContent;
    const procedures = content[1].hdevelop;
    
    console.log('[halcon-hdevelop] 开始序列化笔记本');
    console.log('[halcon-hdevelop] procedure 数量:', procedures.length);
    
    let cellIndex = 1;
    
    procedures.forEach((procedure: any, index: number) => {
      console.log('[halcon-hdevelop] 处理 procedure:', procedure[":@"]?.["@_name"]);
      
      const apiCells: vscode.NotebookCellData[] = [];
      let codeCell: vscode.NotebookCellData | null = null;
      
      while (cellIndex < data.cells.length) {
        const cell = data.cells[cellIndex];
        
        if (cell.kind === vscode.NotebookCellKind.Markup) {
          // 如果已经收集了 cells，说明遇到了下一个 procedure
          if (apiCells.length > 0 || codeCell) {
            console.log(`[halcon-hdevelop] 遇到新的 procedure 标题，停止`);
            break;
          }
          console.log(`[halcon-hdevelop] 跳过 markup cell`);
          cellIndex++;
          continue;
        }
        if (cell.languageId === 'hdevelop.api') {
          console.log(`[halcon-hdevelop] 收集 API cell`);
          apiCells.push(cell);
          cellIndex++;
        } else if (cell.languageId === 'hdevelop') {
          console.log(`[halcon-hdevelop] 找到 Code cell`);
          codeCell = cell;
          cellIndex++;
          break;
        }
      }
      
      while (apiCells.length < 4) {
        apiCells.unshift(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'hdevelop.api'));
      }
      
      if (!codeCell) {
        codeCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'hdevelop');
      }
      
      const ioParams = HDevelopSerializer.serializeAPIParameters(apiCells[0]);
      const ooParams = HDevelopSerializer.serializeAPIParameters(apiCells[1]);
      const icParams = HDevelopSerializer.serializeAPIParameters(apiCells[2]);
      const ocParams = HDevelopSerializer.serializeAPIParameters(apiCells[3]);
      
      console.log('[halcon-hdevelop] ioParams:', ioParams.length, 'ooParams:', ooParams.length, 'icParams:', icParams.length, 'ocParams:', ocParams.length);
      
      const procParts = procedure.procedure;
      
      // Update interface
      let interfacePart = procParts.find((p: any) => p.interface);
      if (!interfacePart) {
        interfacePart = { interface: [{io: ioParams}, {oo: ooParams}, {ic: icParams}, {oc: ocParams}] };
        procParts.push(interfacePart);
      } else {
        interfacePart.interface = [{io: ioParams}, {oo: ooParams}, {ic: icParams}, {oc: ocParams}];
      }
      
      // Update body
      let bodyPart = procParts.find((p: any) => p.body);
      const body = HDevelopSerializer.serializeCodeCell(codeCell);
      if (!bodyPart) {
        bodyPart = { body: body };
        procParts.push(bodyPart);
      } else {
        bodyPart.body = body;
      }
      
      // Update docu
      const api: ProcedureAPI = [{io: ioParams}, {oo: ooParams}, {ic: icParams}, {oc: ocParams}];
      const docu = HDevelopSerializer.generateDocu(api);
      let docuPart = procParts.find((p: any) => p.docu);
      if (!docuPart) {
        docuPart = { docu: docu };
        procParts.push(docuPart);
      } else {
        docuPart.docu = docu;
      }
      
      console.log('[halcon-hdevelop] procedure 更新完成:', procedure[":@"]?.["@_name"]);
    });

    console.log('[halcon-hdevelop] 开始构建 XML');
    
    const fileContents = HDevelopSerializer.serializer.build(content);
    console.log('[halcon-hdevelop] XML 输出长度:', fileContents.length);
    
    const result = HDevelopSerializer.textEncoder.encode(fileContents);
    console.log('[halcon-hdevelop] 序列化完成，字节数:', result.length);
    return result;
  }
}