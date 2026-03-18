/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { ApiSection, formatAPIParameters, resolveApiSectionCells } from "./HDevelopApi";
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

interface HDevelopApiCellMetadata {
  apiSection?: ApiSection;
}

interface HDevelopProcedureHeaderCellMetadata {
  cellRole?: 'procedureHeader';
  procedureName?: string;
  signature?: string;
}

interface HDevelopProcedureCellMetadata {
  procedureName?: string;
  signature?: string;
  cellRole?: 'procedureHeader' | 'procedureApi' | 'procedureCode';
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

  private static extractSignatureParameters(proc: any): Array<{
    direction: 'INPUT' | 'OUTPUT';
    baseType: string;
    name: string;
    dimension: number;
  }> {
    const procParts = proc.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface;
    if (!Array.isArray(api) || api.length === 0) {
      return [];
    }

    const params: Array<{
      direction: 'INPUT' | 'OUTPUT';
      baseType: string;
      name: string;
      dimension: number;
    }> = [];

    for (const section of api) {
      const sectionKey = (["io", "oo", "ic", "oc"] as const).find((key) => Array.isArray(section?.[key]));
      if (!sectionKey) {
        continue;
      }

      const direction = sectionKey === "io" || sectionKey === "ic" ? "INPUT" : "OUTPUT";

      for (const param of section[sectionKey] as any[]) {
        const paramData = param?.[":@"];
        const name = paramData?.["@_name"];
        if (!name) {
          continue;
        }

        params.push({
          direction,
          baseType: paramData?.["@_base_type"] || "ctrl",
          name,
          dimension: Number(paramData?.["@_dimension"] || 0),
        });
      }
    }

    return params;
  }

  private static buildCompactProcedureHeader(
    procedureName: string,
    signature: string,
    counts: {
      inputObjects: number;
      outputObjects: number;
      inputControls: number;
      outputControls: number;
      codeLines: number;
    }
  ): string {
    void counts;
    const displaySignature = signature
      .slice(1, -1)
      .replace(/\[INPUT\]/g, '<span style="color: var(--vscode-terminal-ansiGreen); font-weight: 700; letter-spacing: 0.02em;">INPUT</span>')
      .replace(/\[OUTPUT\]/g, '<span style="color: var(--vscode-terminal-ansiYellow); font-weight: 700; letter-spacing: 0.02em;">OUTPUT</span>')
      .replace(/\biconic\b/g, '<span style="color: var(--vscode-textLink-foreground); font-weight: 600;">iconic</span>')
      .replace(/\bctrl\b/g, '<span style="color: var(--vscode-textLink-foreground); font-weight: 600;">ctrl</span>');

    return `##### <span style="font-weight: 400;">${procedureName}</span><span style="font-size: 0.92em; font-weight: 400; color: var(--vscode-descriptionForeground);">(${displaySignature})</span>`;
  }

  private static buildProcedureSignature(proc: any): string {
    try {
      const params = this.extractSignatureParameters(proc);
      if (params.length === 0) {
        return "()";
      }

      return `(${params.map((param) => {
        const dimensionSuffix = param.dimension > 0 ? `[${param.dimension}]` : "";
        return `[${param.direction}] ${param.baseType} ${param.name}${dimensionSuffix}`;
      }).join(", ")})`;
    } catch (error) {
      console.error("[halcon-hdevelop] 构建函数签名时出错:", error);
      return "()";
    }
  }

  private static parseData(fileContent: Uint8Array): XMLData {
    const decodedContent = HDevelopSerializer.textDecoder.decode(fileContent);
    
    let data: XMLData;
    try {
      data = HDevelopSerializer.parser.parse(decodedContent) as XMLData;

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
      
      // Normalize each procedure to ensure consistent structure
      procedureContainers.forEach((container: any, index: number) => {
        const procName = container[":@"]?.["@_name"] || `procedure_${index}`;
        let procParts = container.procedure;
        
        // 检查 procParts 是否存在
        if (!procParts) {
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
        
      });

      data[0][":@"]["@_version"] = "1.0";
      // 更新 hdevelop 数组为过滤后的结果
      data[1].hdevelop = procedureContainers;
      
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
    return formatAPIParameters(parameters, descriptions, ioType);
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
    const code = HDevelopSerializer.deserializeAPIParameters(inputObjects, descriptions, 'input');
    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api');
    cell.metadata = { apiSection: 'io' } as HDevelopApiCellMetadata;
    return cell;
  }

  private deserializeOutputObjectCell(data: XMLData): vscode.NotebookCellData {
    const procedure = data[1].hdevelop[0] as any;
    const procParts = procedure.procedure;
    const interfacePart = procParts.find((p: any) => p.interface);
    const api = interfacePart?.interface || [{io: []}, {oo: []}, {ic: []}, {oc: []}];
    const outputObjects = HDevelopSerializer.extractParametersFromSection(api, 'oo');
    const docuPart = procParts.find((p: any) => p.docu);
    const descriptions = HDevelopSerializer.extractParameterDescriptions(docuPart?.docu);
    const code = HDevelopSerializer.deserializeAPIParameters(outputObjects, descriptions, 'output');
    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api');
    cell.metadata = { apiSection: 'oo' } as HDevelopApiCellMetadata;
    return cell;
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

    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api');
    cell.metadata = { apiSection: 'ic' } as HDevelopApiCellMetadata;
    return cell;
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

    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'hdevelop.api');
    cell.metadata = { apiSection: 'oc' } as HDevelopApiCellMetadata;
    return cell;
  }

  private static attachProcedureMetadata(
    cell: vscode.NotebookCellData,
    procedureName: string,
    signature: string,
    cellRole: HDevelopProcedureCellMetadata['cellRole']
  ): vscode.NotebookCellData {
    cell.metadata = {
      ...(cell.metadata as Record<string, unknown> | undefined),
      procedureName,
      signature,
      cellRole,
    } as HDevelopProcedureCellMetadata & HDevelopApiCellMetadata;

    return cell;
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
        '**HDevelop Procedures**\n\nCompact notebook view for procedures, parameters, and code.',
        'markdown'
      ));

    procedures.forEach((procedure: any, index: number) => {
      try {
        const procedureName = procedure[":@"]?.["@_name"] || `procedure_${index}`;
        
        // 检查 procedure 是否有实际内容
        const procParts = procedure.procedure;
        if (!procParts || !Array.isArray(procParts)) {
          return;
        }
        
        const bodyPart = procParts.find((p: any) => p.body);
        const body = bodyPart?.body || [];
        
        // 检查 body 是否为空
        if (body.length === 0) {
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
          return;
        }
        
        const signature = HDevelopSerializer.buildProcedureSignature(procedure);
        const procedureData: XMLData = [
          hdevelopData[0],
          { hdevelop: [procedure] }
        ];
        const inputObjectsCell = this.deserializeInputObjectCell(procedureData);
        const outputObjectsCell = this.deserializeOutputObjectCell(procedureData);
        const inputControlsCell = this.deserializeInputControlCell(procedureData);
        const outputControlsCell = this.deserializeOutputControlCell(procedureData);
        const codeCell = this.deserializeCodeCell(procedureData);
        const codeLineCount = codeCell.value
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0).length;
        
        const headerCell = new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          HDevelopSerializer.buildCompactProcedureHeader(procedureName, signature, {
            inputObjects: inputObjectsCell.value.trim() ? inputObjectsCell.value.split('\n').filter(line => line.trim().length > 0).length : 0,
            outputObjects: outputObjectsCell.value.trim() ? outputObjectsCell.value.split('\n').filter(line => line.trim().length > 0).length : 0,
            inputControls: inputControlsCell.value.trim() ? inputControlsCell.value.split('\n').filter(line => line.trim().length > 0).length : 0,
            outputControls: outputControlsCell.value.trim() ? outputControlsCell.value.split('\n').filter(line => line.trim().length > 0).length : 0,
            codeLines: codeLineCount,
          }),
          'markdown'
        );
        headerCell.metadata = {
          cellRole: 'procedureHeader',
          procedureName,
          signature,
        } as HDevelopProcedureHeaderCellMetadata;
        cells.push(headerCell);
        
        if (inputObjectsCell.value.trim()) {
          cells.push(HDevelopSerializer.attachProcedureMetadata(inputObjectsCell, procedureName, signature, 'procedureApi'));
        }
        if (outputObjectsCell.value.trim()) {
          cells.push(HDevelopSerializer.attachProcedureMetadata(outputObjectsCell, procedureName, signature, 'procedureApi'));
        }
        if (inputControlsCell.value.trim()) {
          cells.push(HDevelopSerializer.attachProcedureMetadata(inputControlsCell, procedureName, signature, 'procedureApi'));
        }
        if (outputControlsCell.value.trim()) {
          cells.push(HDevelopSerializer.attachProcedureMetadata(outputControlsCell, procedureName, signature, 'procedureApi'));
        }
        cells.push(HDevelopSerializer.attachProcedureMetadata(codeCell, procedureName, signature, 'procedureCode'));
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
    
    let cellIndex = 1;
    
    procedures.forEach((procedure: any, index: number) => {
      const apiCells: vscode.NotebookCellData[] = [];
      let codeCell: vscode.NotebookCellData | null = null;
      
      while (cellIndex < data.cells.length) {
        const cell = data.cells[cellIndex];
        
        if (cell.kind === vscode.NotebookCellKind.Markup) {
          // 如果已经收集了 cells，说明遇到了下一个 procedure
          if (apiCells.length > 0 || codeCell) {
            break;
          }
          cellIndex++;
          continue;
        }
        if (cell.languageId === 'hdevelop.api') {
          apiCells.push(cell);
          cellIndex++;
        } else if (cell.languageId === 'hdevelop') {
          codeCell = cell;
          cellIndex++;
          break;
        }
      }
      
      const resolvedApiCells = resolveApiSectionCells(apiCells);
      const emptyApiCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'hdevelop.api');
      
      if (!codeCell) {
        codeCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'hdevelop');
      }
      
      const ioParams = HDevelopSerializer.serializeAPIParameters(resolvedApiCells.io ?? emptyApiCell);
      const ooParams = HDevelopSerializer.serializeAPIParameters(resolvedApiCells.oo ?? emptyApiCell);
      const icParams = HDevelopSerializer.serializeAPIParameters(resolvedApiCells.ic ?? emptyApiCell);
      const ocParams = HDevelopSerializer.serializeAPIParameters(resolvedApiCells.oc ?? emptyApiCell);
      
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
      
    });
    
    const fileContents = HDevelopSerializer.serializer.build(content);
    
    return HDevelopSerializer.textEncoder.encode(fileContents);
  }
}
