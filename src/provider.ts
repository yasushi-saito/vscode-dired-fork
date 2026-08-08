'use strict';

import * as vscode from 'vscode';
import * as path from 'path-browserify';

import FileItem, { SortOrder, DIRED_SCHEME } from './fileItem';

const FIXED_URI: vscode.Uri = vscode.Uri.parse('dired://fixed_window');

export function getTargetLineForOpenDir(buffers: string[], initialFile: string, savedCursorPosition: number | null, lineCount: number): number {
    if (typeof savedCursorPosition === "number" && savedCursorPosition > 0 && savedCursorPosition < lineCount) {
        return savedCursorPosition;
    }

    if (initialFile) {
        const normalizedInitialFile = initialFile.trim();
        for (let i = 1; i < buffers.length; i++) {
            if (buffers[i].includes(normalizedInitialFile)) {
                return i;
            }
        }
    }

    return 0;
}

export default class DiredProvider implements vscode.TextDocumentContentProvider {
    // ディレクトリごとのカーソル位置保存用
    private _cursorPositions: { [dir: string]: number } = {};

    // ディレクトリごとのカーソル位置保存用
    static scheme = DIRED_SCHEME; // ex: dired://<directory>

    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _fixed_window: boolean;
    private _show_dot_files: boolean = true;
    private _sortOrder: SortOrder = SortOrder.Alphabetical;
    private _buffers: string[] = []; // This is a temporary buffer. Reused by multiple tabs.
    private static readonly _outputChannel = vscode.window.createOutputChannel('Dired');

    private static logError(message: string, err?: any) {
        this._outputChannel.appendLine(message);
        if (err) {
            if (err instanceof Error && err.stack) {
                this._outputChannel.appendLine(err.stack);
            } else {
                this._outputChannel.appendLine(String(err));
            }
        }
    }

    constructor(fixed_window: boolean) {
        this._fixed_window = fixed_window;
        // カーソル位置監視イベント登録
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            const doc = editor.document;
            if (doc && doc.uri.scheme === DiredProvider.scheme) {
                const dirLine = doc.lineAt(0).text;
                const match = dirLine.match(/^([^:]+):/);
                if (match) {
                    const dir = match[1];
                    const line = editor.selection.active.line;
                    // 0行目（ヘッダ）は除外
                    if (line > 0) {
                        this._cursorPositions[dir] = line;
                    }
                }
            }
        });
    }

    dispose() {
        this._onDidChange.dispose();
    }

    get onDidChange() {
        return this._onDidChange.event;
    }

    get dirname() {
        const at = vscode.window.activeTextEditor;
        if (!at) {
            return undefined;
        }
        const doc = at.document;
        if (!doc) {
            return undefined;
        }
        const line0 = doc.lineAt(0).text;
        const match = line0.match(/^([^:]+):/);
        return match ? match[1] : undefined;
    }

    toggleDotFiles() {
        this._show_dot_files = !this._show_dot_files;
        this.reload();
    }

    toggleSort() {
        this._sortOrder = (this._sortOrder + 1) % 4; // Cycle through SortOrder enum
        this.reload();
    }

    async enter() {
        const f = this.getFile();
        if (!f) {
            return;
        }
        const uri = f.uri;
        if (!uri) {
            return;
        }
        if (uri.scheme !== DiredProvider.scheme) {
            await this.showFile(uri);
            return;
        }
        this.openDir(f.path);
    }

    reload() {
        if (!this.dirname) {
            return;
        }
        this.createBuffer(this.dirname)
            .then(() => this._onDidChange.fire(this.uri));
    }

    async createDir(dirname: string) {
        if (this.dirname) {
            const p = path.join(this.dirname, dirname);
            let uri = vscode.Uri.file(p);
            await vscode.workspace.fs.createDirectory(uri);
            this.reload();
        }
    }

    async createFile(filename: string) {
        const uri = vscode.Uri.file(filename);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false });
        this.reload();
    }

    async rename(newName: string) {
        const f = this.getFile();
        if (!f) {
            return;
        }
        if (this.dirname) {
            const sourcePath = f.path;
            let targetPath: string;

            if (path.isAbsolute(newName)) {
                targetPath = newName;
            } else {
                targetPath = path.resolve(this.dirname, newName);
            }

            try {
                let finalTargetPath = targetPath;
                const sourceUri = vscode.Uri.file(sourcePath);
                const targetUri = vscode.Uri.file(targetPath);

                try {
                    const targetStats = await vscode.workspace.fs.stat(targetUri);
                    if ((targetStats.type & vscode.FileType.Directory) !== 0) {
                        finalTargetPath = path.join(targetPath, path.basename(sourcePath));
                    }
                } catch (targetStatErr: any) {
                    // Target path doesn't exist, proceed
                }

                const finalTargetUri = vscode.Uri.file(finalTargetPath);
                const targetDirUri = vscode.Uri.file(path.dirname(finalTargetPath));

                try {
                    await vscode.workspace.fs.stat(targetDirUri);
                } catch {
                    await vscode.workspace.fs.createDirectory(targetDirUri);
                }

                await vscode.workspace.fs.rename(sourceUri, finalTargetUri, { overwrite: true });
                vscode.window.showInformationMessage(`${f.fileName} is moved to ${finalTargetPath}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to move ${f.fileName} to ${targetPath}: ${err.message}`);
            }

            this.reload();
        }
    }

    async copy(newName: string) {
        const f = this.getFile();
        if (!f) {
            return;
        }
        if (this.dirname) {
            const sourcePath = f.path;
            let targetPath: string;

            if (path.isAbsolute(newName)) {
                targetPath = newName;
            } else {
                targetPath = path.resolve(this.dirname, newName);
            }

            try {
                const sourceUri = vscode.Uri.file(sourcePath);
                let finalTargetPath = targetPath;
                const targetUri = vscode.Uri.file(targetPath);

                try {
                    const targetStats = await vscode.workspace.fs.stat(targetUri);
                    if ((targetStats.type & vscode.FileType.Directory) !== 0) {
                        finalTargetPath = path.join(targetPath, path.basename(sourcePath));
                    }
                } catch (targetStatErr: any) {
                    // Target doesn't exist, proceed
                }

                const finalTargetUri = vscode.Uri.file(finalTargetPath);
                const targetDirUri = vscode.Uri.file(path.dirname(finalTargetPath));

                try {
                    await vscode.workspace.fs.stat(targetDirUri);
                } catch {
                    await vscode.workspace.fs.createDirectory(targetDirUri);
                }

                await vscode.workspace.fs.copy(sourceUri, finalTargetUri, { overwrite: true });
                vscode.window.showInformationMessage(`${f.fileName} is copied to ${finalTargetPath}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to copy ${f.fileName} to ${targetPath}: ${err.message}`);
            }

            this.reload();
        }
    }

    // Add the new copyMultiple method here
    async copyMultiple(targetDir: string, items: FileItem[]) {
        if (!this.dirname) {
            return;
        }

        let targetPath: string;
        if (path.isAbsolute(targetDir)) {
            targetPath = targetDir;
        } else {
            targetPath = path.resolve(this.dirname, targetDir);
        }

        const targetUri = vscode.Uri.file(targetPath);

        try {
            try {
                const targetStats = await vscode.workspace.fs.stat(targetUri);
                if ((targetStats.type & vscode.FileType.Directory) === 0) {
                    vscode.window.showErrorMessage(`Target path ${targetPath} exists but is not a directory.`);
                    return;
                }
            } catch {
                await vscode.workspace.fs.createDirectory(targetUri);
            }

            let successCount = 0;
            let errorCount = 0;
            const errors: string[] = [];

            for (const item of items) {
                const sourcePath = item.path;
                const finalTargetPath = path.join(targetPath, item.fileName);
                const sourceUri = vscode.Uri.file(sourcePath);
                const finalTargetUri = vscode.Uri.file(finalTargetPath);

                try {
                    await vscode.workspace.fs.copy(sourceUri, finalTargetUri, { overwrite: true });
                    successCount++;
                } catch (err: any) {
                    errorCount++;
                    errors.push(`Failed to copy ${item.fileName}: ${err.message}`);
                    DiredProvider.logError(`Failed to copy ${sourcePath} to ${finalTargetPath}:`, err);
                }
            }

            if (errorCount > 0) {
                vscode.window.showErrorMessage(`Copied ${successCount} items, but failed to copy ${errorCount} items. Check logs for details.`);
                errors.forEach(e => DiredProvider._outputChannel.appendLine(e));
            } else {
                vscode.window.showInformationMessage(`Successfully copied ${successCount} items to ${targetPath}`);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to prepare target directory ${targetPath}: ${err.message}`);
        }

        this.reload();
    }

    async moveMultiple(targetDir: string, items: FileItem[]) {
        if (!this.dirname) {
            return;
        }

        let targetPath: string;
        if (path.isAbsolute(targetDir)) {
            targetPath = targetDir;
        } else {
            targetPath = path.resolve(this.dirname, targetDir);
        }

        const targetUri = vscode.Uri.file(targetPath);

        try {
            try {
                const targetStats = await vscode.workspace.fs.stat(targetUri);
                if ((targetStats.type & vscode.FileType.Directory) === 0) {
                    vscode.window.showErrorMessage(`Target path ${targetPath} exists but is not a directory.`);
                    return;
                }
            } catch {
                await vscode.workspace.fs.createDirectory(targetUri);
            }

            let successCount = 0;
            let errorCount = 0;
            const errors: string[] = [];

            for (const item of items) {
                const sourcePath = item.path;
                const finalTargetPath = path.join(targetPath, item.fileName);
                const sourceUri = vscode.Uri.file(sourcePath);
                const finalTargetUri = vscode.Uri.file(finalTargetPath);

                try {
                    if (sourcePath === finalTargetPath || sourcePath === targetPath) {
                        errors.push(`Skipping move: source and destination are the same for ${item.fileName}`);
                        errorCount++;
                        continue;
                    }
                    await vscode.workspace.fs.rename(sourceUri, finalTargetUri, { overwrite: true });
                    successCount++;
                } catch (err: any) {
                    errorCount++;
                    errors.push(`Failed to move ${item.fileName}: ${err.message}`);
                    DiredProvider.logError(`Failed to move ${sourcePath} to ${finalTargetPath}:`, err);
                }
            }

            if (errorCount > 0) {
                vscode.window.showErrorMessage(`Moved ${successCount} items, but failed to move ${errorCount} items. Check logs for details.`);
                errors.forEach(e => DiredProvider._outputChannel.appendLine(e));
            } else {
                vscode.window.showInformationMessage(`Successfully moved ${successCount} items to ${targetPath}`);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to prepare target directory ${targetPath}: ${err.message}`);
        }

        this.reload();
    }

    // Add the new getSelectedItems method here
    getSelectedItems(): FileItem[] {
        const selectedItems: FileItem[] = [];
        const at = vscode.window.activeTextEditor;
        if (!at || !this.dirname) {
            return selectedItems;
        }
        const doc = at.document;
        if (!doc || doc.uri.scheme !== DiredProvider.scheme) {
            return selectedItems;
        }

        for (let i = 1; i < doc.lineCount; i++) { // Start from line 1 to skip header
            const lineText = doc.lineAt(i).text;
            try {
                const fileItem = FileItem.parseLine(this.dirname, lineText);
                if (fileItem.isSelected) {
                    selectedItems.push(fileItem);
                }
            } catch (e) {
                // Ignore lines that cannot be parsed
                DiredProvider.logError(`Could not parse line ${i}: ${lineText}`, e);
            }
        }
        return selectedItems;
    }

    async delete() {
        const f = this.getFile();
        if (!f) {
            vscode.window.showWarningMessage("No file or directory under cursor to delete.");
            return;
        }
        if (this.dirname) {
            const n = path.join(this.dirname, f.fileName);
            const uri = vscode.Uri.file(n);
            try {
                await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
                this.reload();
                vscode.window.showInformationMessage(`${f.fileName} was deleted`);
            } catch (err: any) {
                 vscode.window.showErrorMessage(`Failed to delete ${f.fileName}: ${err.message}`);
            }
        }
    }

    async deleteMultiple(items: FileItem[]) {
        if (!this.dirname) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];

        for (const item of items) {
            const itemPath = item.path;
            const uri = vscode.Uri.file(itemPath);
            try {
                await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
                successCount++;
            } catch (err: any) {
                errorCount++;
                errors.push(`Failed to delete ${item.fileName}: ${err.message}`);
                DiredProvider.logError(`Failed to delete ${itemPath}:`, err);
            }
        }

        this.reload();

        if (errorCount > 0) {
            vscode.window.showErrorMessage(`Deleted ${successCount} items, but failed to delete ${errorCount} items. Check logs for details.`);
            errors.forEach(e => DiredProvider._outputChannel.appendLine(e));
        } else {
            vscode.window.showInformationMessage(`Successfully deleted ${successCount} items.`);
        }
    }

    select() {
        this.selectFiles(true);
    }

    unselect() {
        this.selectFiles(false);
    }

    unselectAll() {
        if (!this.dirname) {
            return;
        }
        const at = vscode.window.activeTextEditor;
        if (!at) {
            return;
        }
        const doc = at.document;
        if (!doc || doc.uri.scheme !== DiredProvider.scheme) {
            return;
        }

        let changed = false;
        for (let i = 1; i < this._buffers.length; i++) { // Start from 1 to skip header
            try {
                const f = FileItem.parseLine(this.dirname, this._buffers[i]);
                if (f.isSelected) {
                    f.select(false);
                    this._buffers[i] = f.line();
                    changed = true;
                }
            } catch (e) {
                // Ignore lines that cannot be parsed
                DiredProvider.logError(`Could not parse line ${i} for unselectAll: ${this._buffers[i]}`, e);
            }
        }

        if (changed) {
            const uri = this.uri;
            this._onDidChange.fire(uri);
        }
    }

    goUpDir() {
        if (!this.dirname || this.dirname === "/") {
            return;
        }
        const p = path.join(this.dirname, "..");
        this.openDir(p);
    }

    // Open the directory given by `path`. If `initialFile` is provided, it will
    // be used to set the initial cursor position. `initialFile` shall not
    // contain '/'.
    async openDir(path: string, initialFile: string = "") {
        const f = new FileItem(path, "", null, true); // Incomplete FileItem just to get URI.
        const uri = f.uri;
        if (uri) {
            await this.createBuffer(path);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(
                doc,
                this.getTextDocumentShowOptions(true)
            );

            // カーソル位置復元処理
            const lineCount = doc.lineCount;
            const saved = this._cursorPositions[path];
            const targetLine = getTargetLineForOpenDir(this._buffers, initialFile, saved ?? null, lineCount);
            const newSelection = new vscode.Selection(targetLine, 0, targetLine, 0);
            editor.selection = newSelection;
            editor.revealRange(new vscode.Range(targetLine, 0, targetLine, 0));
            // 言語モード設定
            vscode.languages.setTextDocumentLanguage(doc, "dired");
        }
    }

    async showFile(uri: vscode.Uri) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, this.getTextDocumentShowOptions(false));
        // TODO: show warning when open file failed
        // vscode.window.showErrorMessage(`Could not open file ${uri.fsPath}: ${err}`);
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        return this.render();
    }

    /**
     * Gets the full path of the file/directory under the cursor.
     * Returns undefined if the cursor is not on a valid file/directory line.
     */
    public getPathUnderCursor(): string | undefined {
        const fileItem = this.getFile();
        return fileItem?.path;
    }

    private get uri(): vscode.Uri {
        if (this.dirname) {
            const f = new FileItem(this.dirname, "", null, true); // Incomplete FileItem just to get URI.
            const uri = f.uri;
            if (uri) {
                return uri;
            }
        }
        return FIXED_URI;
    }

    private render(): Thenable<string> {
        return new Promise((resolve) => {
            resolve(this._buffers.join('\n'));
        });
    }

    private async createBuffer(dirname: string): Promise<string[]> {
        let files: FileItem[] = [];
        const uri = vscode.Uri.file(dirname);
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if ((stat.type & vscode.FileType.Directory) !== 0) {
                files = await this.readDir(dirname);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Could not read ${dirname}: ${err}`);
        }

        const sortOrderName = SortOrder[this._sortOrder];
        this._buffers = [
            `${dirname}: (Sort: ${sortOrderName})`, // header line
        ];
        this._buffers = this._buffers.concat(files.map((f) => f.line()));

        return this._buffers;
    }

    private async readDir(dirname: string): Promise<FileItem[]> {
        const dirUri = vscode.Uri.file(dirname);
        const entries = await vscode.workspace.fs.readDirectory(dirUri);

        const fileItemsPromises = entries.map(async ([filename, type]) => {
            const p = path.join(dirname, filename);
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
                return FileItem.create(dirname, filename, stat);
            } catch (err) {
                vscode.window.showErrorMessage(`Could not get stat of ${p}: ${err}`);
                return null;
            }
        });

        const fileItemsNullable = await Promise.all(fileItemsPromises);
        let fileItems = fileItemsNullable.filter((item): item is FileItem => item !== null)
            .filter((fileItem) => {
                if (this._show_dot_files) return true;
                return fileItem.fileName.substring(0, 1) != '.';
            });

        let dotItem: FileItem | null = null;
        let dotDotItem: FileItem | null = null;
        try {
            const dotStat = await vscode.workspace.fs.stat(dirUri);
            dotItem = FileItem.create(dirname, ".", dotStat);
        } catch {}
        try {
            const dotDotStat = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dirname, "..")));
            dotDotItem = FileItem.create(dirname, "..", dotDotStat);
        } catch {}

        const dirs = fileItems.filter(item => item.isDirectory && item.fileName !== '.' && item.fileName !== '..');
        const filez = fileItems.filter(item => !item.isDirectory);

        const sortFn = (a: FileItem, b: FileItem) => {
            switch (this._sortOrder) {
                case SortOrder.Mtime:
                    return b.stat!.mtime - a.stat!.mtime;
                case SortOrder.Ext:
                    return path.extname(a.fileName).localeCompare(path.extname(b.fileName));
                case SortOrder.Size:
                    if (a.isDirectory && b.isDirectory) {
                        return a.fileName.localeCompare(b.fileName);
                    }
                    return b.stat!.size - a.stat!.size;
                case SortOrder.Alphabetical:
                default:
                    return a.fileName.localeCompare(b.fileName);
            }
        };

        dirs.sort(sortFn);
        filez.sort(sortFn);

        let res: FileItem[] = [];
        if (dotItem) res.push(dotItem);
        if (dotDotItem) res.push(dotDotItem);
        res = res.concat(dirs);
        res = res.concat(filez);

        return res;
    }

    private getFile(): FileItem | null {
        const at = vscode.window.activeTextEditor;
        if (!at) {
            return null;
        }
        const cursor = at.selection.active;
        if (cursor.line < 1) {
            return null;
        }
        const lineText = at.document.lineAt(cursor.line);
        if (this.dirname && lineText) {
            return FileItem.parseLine(this.dirname, lineText.text);
        }
        return null;
    }

    private selectFiles(value: boolean) {
        if (!this.dirname) {
            return;
        }
        const at = vscode.window.activeTextEditor;
        if (!at) {
            return;
        }
        const doc = at.document;
        if (!doc) {
            return;
        }
        this._buffers = [];
        for (let i = 0; i < doc.lineCount; i++) {
            this._buffers.push(doc.lineAt(i).text);
        }

        let start = 0;
        let end = 0;
        let allowSelectDot = false; // Want to copy emacs's behavior exactly

        if (at.selection.isEmpty) {
            const cursor = at.selection.active;
            if (cursor.line === 0) { // Select all
                start = 1;
                end = doc.lineCount;
            } else {
                allowSelectDot = true;
                start = cursor.line;
                end = cursor.line + 1;
                vscode.commands.executeCommand("cursorMove", { to: "down", by: "line" });
            }
        } else {
            start = at.selection.start.line;
            end = at.selection.end.line;
        }

        for (let i = start; i < end; i++) {
            const f = FileItem.parseLine(this.dirname, this._buffers[i]);
            if (f.fileName === "." || f.fileName === "..") {
                if (!allowSelectDot) {
                    continue;
                }
            }
            f.select(value);
            this._buffers[i] = f.line();
        }
        const uri = this.uri;
        this._onDidChange.fire(uri);
    }

    private getTextDocumentShowOptions(fixed_window: boolean): vscode.TextDocumentShowOptions {
        const opts: vscode.TextDocumentShowOptions = {
            preview: fixed_window,
            viewColumn: vscode.ViewColumn.Active
        };
        return opts;
    }
}
