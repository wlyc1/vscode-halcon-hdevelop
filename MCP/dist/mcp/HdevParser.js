"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HdevParser = void 0;
/* eslint-disable @typescript-eslint/naming-convention */
const fast_xml_parser_1 = require("fast-xml-parser");
// ==================== 解析器实现 ====================
class HdevParser {
    static parser = new fast_xml_parser_1.XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        parseAttributeValue: true,
        trimValues: false,
    });
    /**
     * 解析 Hdev XML 内容
     */
    static parse(xmlContent) {
        const data = this.parser.parse(xmlContent);
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
        // 过滤掉非 procedure 元素
        const procedureContainers = hdevelopArray.filter((container) => {
            return container.procedure && Array.isArray(container.procedure);
        });
        data[1].hdevelop = procedureContainers;
        return data;
    }
    /**
     * 从 XML 数据提取 Procedure 信息
     */
    static extractProcedureInfo(data) {
        const procedures = [];
        const hdevelopArray = data[1].hdevelop;
        for (const container of hdevelopArray) {
            const procInfo = this.parseProcedure(container);
            if (procInfo) {
                procedures.push(procInfo);
            }
        }
        return procedures;
    }
    /**
     * 解析单个 Procedure
     */
    static parseProcedure(container) {
        const procName = container[":@"]?.["@_name"];
        if (!procName)
            return null;
        const procParts = container.procedure;
        if (!procParts || !Array.isArray(procParts))
            return null;
        // 提取 interface
        const interfacePart = procParts.find((p) => p.interface);
        const interfaceNodes = interfacePart?.interface || [];
        // 提取 body
        const bodyPart = procParts.find((p) => p.body);
        const body = bodyPart?.body || [];
        // 提取 docu
        const docuPart = procParts.find((p) => p.docu);
        const docu = docuPart?.docu;
        // 解析参数
        const parameters = {
            input_objects: this.parseParameters(this.extractInterfaceParameters(interfaceNodes, "io"), docu, "input_object"),
            output_objects: this.parseParameters(this.extractInterfaceParameters(interfaceNodes, "oo"), docu, "output_object"),
            input_controls: this.parseParameters(this.extractInterfaceParameters(interfaceNodes, "ic"), docu, "input_control"),
            output_controls: this.parseParameters(this.extractInterfaceParameters(interfaceNodes, "oc"), docu, "output_control"),
        };
        // 解析代码
        const code = this.parseBody(body);
        // 提取文档
        const docuMap = this.parseDocu(docu);
        // 构建签名
        const signature = this.buildSignature(interfaceNodes);
        // 提取调用的 procedure
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
    /**
     * 从 interface 区域提取指定类型的参数节点
     */
    static extractInterfaceParameters(interfaceNodes, sectionName) {
        if (!Array.isArray(interfaceNodes)) {
            return [];
        }
        const section = interfaceNodes.find((node) => Array.isArray(node?.[sectionName]));
        const sectionNodes = section?.[sectionName];
        if (!Array.isArray(sectionNodes)) {
            return [];
        }
        return sectionNodes.filter((node) => Object.prototype.hasOwnProperty.call(node, "par"));
    }
    /**
     * 按 HDevelop interface 中的原始顺序构建签名
     */
    static buildSignature(interfaceNodes) {
        if (!Array.isArray(interfaceNodes) || interfaceNodes.length === 0) {
            return "()";
        }
        const parts = [];
        for (const section of interfaceNodes) {
            const sectionKey = ["io", "oo", "ic", "oc"].find((key) => Array.isArray(section?.[key]));
            if (!sectionKey) {
                continue;
            }
            const direction = sectionKey === "io" || sectionKey === "ic" ? "INPUT" : "OUTPUT";
            for (const param of section[sectionKey]) {
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
    /**
     * 解析参数列表
     */
    static parseParameters(params, docu, ioType) {
        const docuMap = this.parseDocu(docu);
        const result = [];
        for (const param of params) {
            const paramData = param[":@"];
            if (!paramData)
                continue;
            const name = paramData["@_name"] || "";
            if (!name)
                continue;
            const docuInfo = docuMap.get(name);
            result.push({
                name,
                baseType: paramData["@_base_type"] || "ctrl",
                dimension: paramData["@_dimension"] || 0,
                ioType,
                description: docuInfo?.description,
                typeList: docuInfo?.typeList,
                defaultValue: undefined, // 可从 docu 中提取
            });
        }
        return result;
    }
    /**
     * 解析文档
     */
    static parseDocu(docu) {
        const map = new Map();
        if (!docu || !Array.isArray(docu)) {
            return map;
        }
        const docuElement = docu[0];
        if (!docuElement?.parameters || !Array.isArray(docuElement.parameters)) {
            return map;
        }
        for (const param of docuElement.parameters) {
            const paramId = param?.[":@"]?.["@_id"];
            if (!paramId)
                continue;
            const paramChildren = param?.parameter;
            if (!Array.isArray(paramChildren))
                continue;
            const docuInfo = {};
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
                            .filter((item) => item?.item?.[0]?.["#text"])
                            .map((item) => item.item[0]["#text"]);
                    }
                }
            }
            map.set(paramId, docuInfo);
        }
        return map;
    }
    /**
     * 解析代码体
     */
    static parseBody(body) {
        const lines = [];
        let lineNumber = 1;
        for (const node of body) {
            if ("l" in node) {
                // 代码行
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
            }
            else if ("c" in node) {
                // 注释行
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
    /**
     * 从代码中提取调用的 procedure 名称
     * 排除 Halcon 内置算子和控制流关键字
     */
    static extractCalls(code) {
        const calls = new Set();
        // Halcon 内置算子和控制流关键字（排除列表）
        const builtInKeywords = new Set([
            // 控制流
            'if', 'else', 'endif', 'while', 'endwhile', 'for', 'to', 'by', 'endfor',
            'try', 'catch', 'endtry', 'return', 'exit',
            // 常见 Halcon 算子（小写开头的也排除）
            'dev_update_off', 'dev_update_on', 'dev_close_window', 'dev_open_window',
            'dev_set_draw', 'dev_set_line_width', 'dev_set_color', 'dev_set_font',
            'dev_display', 'dev_clear_window', 'dev_set_shape', 'dev_set_colored',
            'read_image', 'read_region', 'dev_set_window',
            'tuple_gen_range', 'tuple_length', 'tuple_select', 'tuple_concat',
            'count_seconds', 'relative_time', 'str', 'sprintf',
            // 文件操作
            'file_exists', 'open_file', 'close_file', 'fwrite_string', 'fread_line',
            'open_folder', 'close_folder', 'list_folder', 'create_dir', 'remove_file',
            // 图像采集
            'open_framegrabber', 'close_framegrabber', 'grab_image', 'grab_image_start',
            // 窗口操作
            'get_window_extents', 'set_window_extents', 'get_mbutton', 'get_hposition',
            // 常用算子
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
            // 数学运算
            'abs', 'sqrt', 'exp', 'log', 'sin', 'cos', 'tan', 'atan', 'asin', 'acos',
            'round', 'int', 'floor', 'ceil', 'min', 'max', 'mod', 'sign',
            'tuple_abs', 'tuple_sqrt', 'tuple_exp', 'tuple_log', 'tuple_sin', 'tuple_cos',
            'tuple_round', 'tuple_int', 'tuple_floor', 'tuple_ceil', 'tuple_min', 'tuple_max',
            // 字符串操作
            'strlen', 'substr', 'strrchr', 'strcmp', 'stringlower', 'stringupper',
            'tuple_string', 'tuple_number',
            // 其他常用
            'clear_obj', 'gen_empty_region', 'gen_region', 'clip_region',
            'move_region', 'rotate_region', 'scale_region', 'mirror_region',
            'boundary', 'skeleton', 'convexity', 'select_region',
        ]);
        const procedureCallPattern = /(\w+)\s*\(/g;
        for (const codeLine of code) {
            if (codeLine.isComment)
                continue;
            let match;
            while ((match = procedureCallPattern.exec(codeLine.line)) !== null) {
                const procName = match[1];
                // 排除内置关键字和算子
                if (procName && !builtInKeywords.has(procName.toLowerCase())) {
                    // 进一步过滤：排除单字母和纯数字开头的
                    if (!/^[a-z]$/i.test(procName) && !/^\d/.test(procName)) {
                        calls.add(procName);
                    }
                }
            }
        }
        return Array.from(calls);
    }
    /**
     * 解析完整的 Hdev 文件
     */
    static parseFile(filePath, xmlContent) {
        const data = this.parse(xmlContent);
        const procedures = this.extractProcedureInfo(data);
        const procedureMap = new Map();
        for (const proc of procedures) {
            procedureMap.set(proc.name, proc);
        }
        // 提取文件版本信息 - 从 hdevelop 元素的属性中获取
        const hdevelopElement = data[1];
        const fileVersion = hdevelopElement?.[':@']?.['@_file_version'] ||
            hdevelopElement?.file_version;
        const halconVersion = hdevelopElement?.[':@']?.['@_halcon_version'] ||
            hdevelopElement?.halcon_version;
        return {
            filePath,
            fileVersion,
            halconVersion,
            procedures,
            procedureMap,
        };
    }
    /**
     * 构建索引
     */
    static buildIndex(files) {
        const index = {
            files: new Map(),
            procedureMap: new Map(),
            callGraph: new Map(),
        };
        // 添加文件
        for (const file of files) {
            index.files.set(file.filePath, file);
            // 添加 procedure 到索引
            for (const proc of file.procedures) {
                index.procedureMap.set(proc.name, { fileInfo: file, procedure: proc });
                index.callGraph.set(proc.name, proc.calls);
            }
        }
        return index;
    }
    /**
     * 搜索 procedure
     */
    static searchProcedure(index, query) {
        const results = [];
        const queryLower = query.toLowerCase();
        for (const [name, { procedure }] of index.procedureMap) {
            // 名称匹配
            if (name.toLowerCase().includes(queryLower)) {
                results.push(procedure);
                continue;
            }
            // 代码内容匹配
            for (const codeLine of procedure.code) {
                if (codeLine.line.toLowerCase().includes(queryLower)) {
                    results.push(procedure);
                    break;
                }
            }
            // 参数名匹配
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
    /**
     * 获取 procedure 调用链
     */
    static getCallChain(index, procedureName, visited = new Set()) {
        if (visited.has(procedureName)) {
            return [];
        }
        visited.add(procedureName);
        const calls = index.callGraph.get(procedureName) || [];
        const chain = [...calls];
        for (const call of calls) {
            if (index.procedureMap.has(call)) {
                chain.push(...this.getCallChain(index, call, visited));
            }
        }
        return chain;
    }
    /**
     * 将 procedure 格式化为 AI 友好的文本
     */
    static formatProcedureForAI(proc) {
        const lines = [];
        lines.push(`## Procedure: ${proc.name}${proc.signature}`);
        lines.push("");
        // 参数信息
        const allParams = [
            ...proc.parameters.input_objects.map(p => ({ ...p, ioType: 'INPUT_OBJECT' })),
            ...proc.parameters.output_objects.map(p => ({ ...p, ioType: 'OUTPUT_OBJECT' })),
            ...proc.parameters.input_controls.map(p => ({ ...p, ioType: 'INPUT_CONTROL' })),
            ...proc.parameters.output_controls.map(p => ({ ...p, ioType: 'OUTPUT_CONTROL' })),
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
        // 代码
        lines.push("### Code:");
        lines.push("```hdevelop");
        for (const codeLine of proc.code) {
            lines.push(codeLine.line);
        }
        lines.push("```");
        lines.push("");
        // 调用关系
        if (proc.calls.length > 0) {
            lines.push(`### Calls: ${proc.calls.join(", ")}`);
            lines.push("");
        }
        return lines.join("\n");
    }
    /**
     * 将整个文件格式化为 AI 友好的文本
     */
    static formatFileForAI(fileInfo) {
        const lines = [];
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
exports.HdevParser = HdevParser;
