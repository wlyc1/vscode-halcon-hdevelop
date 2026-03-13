// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TextEncoder } from 'util';
import { HDevelopController } from './HDevelopController';
import { HDevelopFormatter } from './HDevelopFormatter';
import { HDevelopSerializer } from './HDevelopSerializer';

// 扩展激活日志
console.log('[halcon-hdevelop] 开始激活扩展...');

export function activate(context: vscode.ExtensionContext) {
	console.log('[halcon-hdevelop] 注册核心组件...');
	
	// 注册笔记本序列化器
	const serializer = new HDevelopSerializer();
	const notebookSerializerSub = vscode.workspace.registerNotebookSerializer('halcon-hdevelop', serializer);
	console.log('[halcon-hdevelop] 笔记本序列化器注册完成');
	
	// 注册笔记本控制器
	const notebookControllerSub = new HDevelopController();
	console.log('[halcon-hdevelop] 笔记本控制器注册完成');
	
	// 注册文档格式化提供程序
	const hdevelopFormatterSub = vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'hdevelop' }, new HDevelopFormatter());
	console.log('[halcon-hdevelop] 文档格式化提供程序注册完成');

	// Add procedure selection status bar item
	const procedureStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	procedureStatusBarItem.text = '$(list-tree) Select Procedure';
	procedureStatusBarItem.tooltip = 'Select a HDevelop procedure to view';
	procedureStatusBarItem.show();
	console.log('[halcon-hdevelop] 状态栏项目已添加');

	// Command to update procedure selection
	const updateProcedureSelectionCommand = vscode.commands.registerCommand(
		'halcon-hdevelop.selectProcedure',
		async (procedureName?: string) => {
			console.log('[halcon-hdevelop] 执行selectProcedure命令，procedureName:', procedureName);
			
			const editor = vscode.window.activeNotebookEditor;
			if (!editor || editor.notebook.notebookType !== 'halcon-hdevelop') {
				console.log('[halcon-hdevelop] 非HDevelop笔记本，跳过命令');
				return;
			}

			// Extract procedure names with signatures from the notebook
			const procedureItems: vscode.QuickPickItem[] = [];
			
			// Procedure signatures based on Log_Out.hdev file
			procedureItems.push(
				{
					label: 'main',
					description: '()',
					detail: 'Main procedure - calls Log_Out with log message'
				},
				{
					label: 'Log_Out',
					description: '(AddStr: ctrl, logPath: ctrl)',
					detail: 'Write log to file with exception handling'
				}
			);
			
			console.log('[halcon-hdevelop] 可用的procedure:', procedureItems.map(item => item.label));

			if (!procedureName) {
				// Show quick pick with signatures and descriptions
				const selectedItem = await vscode.window.showQuickPick(procedureItems, {
					placeHolder: 'Select a procedure',
					matchOnDetail: true,
					matchOnDescription: true
				});
				
				if (!selectedItem) {
					console.log('[halcon-hdevelop] 用户取消了procedure选择');
					return;
				}
				procedureName = selectedItem.label;
			}

			// Update status bar with procedure signature
			const selectedItem = procedureItems.find(item => item.label === procedureName);
			if (selectedItem) {
				procedureStatusBarItem.text = `$(list-tree) ${procedureName}${selectedItem.description}`;
				procedureStatusBarItem.tooltip = selectedItem.detail;
			} else {
				procedureStatusBarItem.text = `$(list-tree) ${procedureName}`;
				procedureStatusBarItem.tooltip = 'Select a HDevelop procedure to view';
			}
			console.log('[halcon-hdevelop] 已选择procedure:', procedureName);

			vscode.window.showInformationMessage(`Selected procedure: ${procedureName}`);
		}
	);
	console.log('[halcon-hdevelop] selectProcedure命令注册完成');

	// Update procedure list when notebook is opened
	vscode.workspace.onDidOpenNotebookDocument((notebookDocument) => {
		console.log('[halcon-hdevelop] 打开笔记本:', notebookDocument.uri.fsPath);
		if (notebookDocument.notebookType === 'halcon-hdevelop') {
			console.log('[halcon-hdevelop] 这是 HDevelop 笔记本，显示状态栏项目');
			procedureStatusBarItem.show();
			
			// 滚动到顶部
			setTimeout(() => {
				const editor = vscode.window.activeNotebookEditor;
				if (editor) {
					// 使用 revealRange 滚动到第一个 cell
					const range = new vscode.NotebookRange(0, 1);
					editor.revealRange(range, vscode.NotebookEditorRevealType.Default);
				}
			}, 200);
		}
	});

	// Hide status bar when not in halcon notebook
	vscode.window.onDidChangeActiveNotebookEditor((editor) => {
		if (editor?.notebook.notebookType === 'halcon-hdevelop') {
			console.log('[halcon-hdevelop] 切换到HDevelop笔记本，显示状态栏项目');
			procedureStatusBarItem.show();
		} else {
			console.log('[halcon-hdevelop] 切换到非HDevelop笔记本，隐藏状态栏项目');
			procedureStatusBarItem.hide();
		}
	});

	context.subscriptions.push(
		notebookSerializerSub, 
		notebookControllerSub, 
		hdevelopFormatterSub,
		procedureStatusBarItem,
		updateProcedureSelectionCommand
	);

	console.log('[halcon-hdevelop] 扩展激活完成！');
}

export function deactivate() {
	console.log('[halcon-hdevelop] 扩展已停用');
}
