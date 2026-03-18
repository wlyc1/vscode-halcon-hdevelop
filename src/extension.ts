// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HDevelopController } from './HDevelopController';
import { HDevelopFormatter } from './HDevelopFormatter';
import { HDevelopSerializer } from './HDevelopSerializer';

interface ProcedureNavItem {
	name: string;
	signature: string;
	headerCellIndex: number;
}

interface ProcedureCellMetadata {
	procedureName?: string;
	signature?: string;
	cellRole?: string;
}

function getProcedureNavItems(editor: vscode.NotebookEditor): ProcedureNavItem[] {
	return editor.notebook.getCells().flatMap((cell, index) => {
		if (cell.kind !== vscode.NotebookCellKind.Markup) {
			return [];
		}

		const metadata = cell.metadata as ProcedureCellMetadata | undefined;
		if (metadata?.cellRole === 'procedureHeader' && metadata.procedureName) {
			return [{
				name: metadata.procedureName,
				signature: metadata.signature || '()',
				headerCellIndex: index,
			}];
		}

		const text = cell.document.getText().trim();
		const compactMatch = text.match(/^#{3,6}\s+([^(]+)(\(.*\))/m);
		if (compactMatch) {
			return [{
				name: compactMatch[1].trim(),
				signature: compactMatch[2],
				headerCellIndex: index,
			}];
		}

		const legacyMatch = text.match(/^###\s+([^(]+)(\(.*\))/m);
		if (legacyMatch) {
			return [{
				name: legacyMatch[1].trim(),
				signature: legacyMatch[2],
				headerCellIndex: index,
			}];
		}

		return [];
	});
}

function getCurrentProcedure(editor: vscode.NotebookEditor, items: ProcedureNavItem[]): ProcedureNavItem | undefined {
	const activeCellIndex = editor.selections[0]?.start ?? 0;
	const activeCell = editor.notebook.cellAt(activeCellIndex);
	const activeMetadata = activeCell?.metadata as ProcedureCellMetadata | undefined;

	if (activeMetadata?.procedureName) {
		return items.find((item) => item.name === activeMetadata.procedureName) ?? {
			name: activeMetadata.procedureName,
			signature: activeMetadata.signature || '()',
			headerCellIndex: activeCellIndex,
		};
	}

	let current: ProcedureNavItem | undefined;

	for (const item of items) {
		if (item.headerCellIndex <= activeCellIndex) {
			current = item;
		}
	}

	return current ?? items[0];
}

export function activate(context: vscode.ExtensionContext) {
	// 注册笔记本序列化器
	const serializer = new HDevelopSerializer();
	const notebookSerializerSub = vscode.workspace.registerNotebookSerializer('halcon-hdevelop', serializer);
	
	// 注册笔记本控制器
	const notebookControllerSub = new HDevelopController();
	
	// 注册文档格式化提供程序
	const hdevelopFormatterSub = vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'hdevelop' }, new HDevelopFormatter());

	// Two-layer navigation: file > procedure
	const fileStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	const procedureStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	procedureStatusBarItem.command = 'halcon-hdevelop.selectProcedure';

	const updateNavigation = (editor?: vscode.NotebookEditor) => {
		if (!editor || editor.notebook.notebookType !== 'halcon-hdevelop') {
			fileStatusBarItem.hide();
			procedureStatusBarItem.hide();
			return;
		}

		const fileName = vscode.workspace.asRelativePath(editor.notebook.uri, false) || editor.notebook.uri.path.split('/').pop() || 'hdev';
		const items = getProcedureNavItems(editor);
		const currentProcedure = getCurrentProcedure(editor, items);

		fileStatusBarItem.text = `$(file-code) ${fileName}`;
		fileStatusBarItem.tooltip = 'Current HDevelop file';
		fileStatusBarItem.show();

		procedureStatusBarItem.text = `$(chevron-right) ${currentProcedure ? `${currentProcedure.name}${currentProcedure.signature}` : 'Select Function'}`;
		procedureStatusBarItem.tooltip = items.length > 0
			? 'Click to list functions and jump'
			: 'No function headers detected in this notebook';
		procedureStatusBarItem.show();
	};

	// Command to update procedure selection
	const updateProcedureSelectionCommand = vscode.commands.registerCommand(
		'halcon-hdevelop.selectProcedure',
		async () => {
			const editor = vscode.window.activeNotebookEditor;
			if (!editor || editor.notebook.notebookType !== 'halcon-hdevelop') {
				return;
			}

			const procedureNavItems = getProcedureNavItems(editor);
			const procedureItems: (vscode.QuickPickItem & { headerCellIndex: number })[] = procedureNavItems.map((item) => ({
				label: item.name,
				description: item.signature,
				detail: `Jump to ${item.name}`,
				headerCellIndex: item.headerCellIndex,
			}));

			if (procedureItems.length === 0) {
				vscode.window.showWarningMessage('No functions found in this HDevelop notebook.');
				return;
			}

			const selectedItem = await vscode.window.showQuickPick(procedureItems, {
				placeHolder: 'Select a procedure',
				matchOnDetail: true,
				matchOnDescription: true
			});
			
			if (!selectedItem) {
				return;
			}

			const range = new vscode.NotebookRange(selectedItem.headerCellIndex, selectedItem.headerCellIndex + 1);
			editor.revealRange(range, vscode.NotebookEditorRevealType.InCenter);
			updateNavigation(editor);
		}
	);

	// Update procedure list when notebook is opened
	vscode.workspace.onDidOpenNotebookDocument((notebookDocument) => {
		if (notebookDocument.notebookType === 'halcon-hdevelop') {
			// 滚动到顶部
			setTimeout(() => {
				const editor = vscode.window.activeNotebookEditor;
				if (editor) {
					// 使用 revealRange 滚动到第一个 cell
					const range = new vscode.NotebookRange(0, 1);
					editor.revealRange(range, vscode.NotebookEditorRevealType.Default);
					updateNavigation(editor);
				}
			}, 200);
		}
	});

	// Update or hide status bar when editor changes
	vscode.window.onDidChangeActiveNotebookEditor((editor) => {
		if (editor?.notebook.notebookType === 'halcon-hdevelop') {
			updateNavigation(editor);
		} else {
			fileStatusBarItem.hide();
			procedureStatusBarItem.hide();
		}
	});

	vscode.window.onDidChangeNotebookEditorSelection((event) => {
		if (event.notebookEditor.notebook.notebookType === 'halcon-hdevelop') {
			updateNavigation(event.notebookEditor);
		}
	});

	context.subscriptions.push(
		notebookSerializerSub, 
		notebookControllerSub, 
		hdevelopFormatterSub,
		fileStatusBarItem,
		procedureStatusBarItem,
		updateProcedureSelectionCommand
	);
}

export function deactivate() {
	return;
}
