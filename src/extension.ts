'use strict';

import * as vscode from 'vscode';
import DiredProvider from './provider';
import FileItem from './fileItem';

import * as path from 'path-browserify';
import { autocompletedInputBox, getCurrentQuickPick, removePathLevel } from './autocompletedInputBox';

export interface ExtensionInternal {
    DiredProvider: DiredProvider,
}

export function activate(context: vscode.ExtensionContext): ExtensionInternal {
    const configuration = vscode.workspace.getConfiguration('dired');

    const fixedWindow = configuration.get('fixedWindow', false);
    const provider = new DiredProvider(fixedWindow);

    const providerRegistrations = vscode.Disposable.from(
        vscode.workspace.registerTextDocumentContentProvider(DiredProvider.scheme, provider),
    );

    // Add completionType argument and make it async returning Promise
    async function pathCompletionFunc(filePathOrDirPath: string, completionType: 'all' | 'directory' | 'file' = 'all'): Promise<vscode.QuickPickItem[]> {
        const items: vscode.QuickPickItem[] = [];
        let dirname: string;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const baseDir = provider.dirname || (workspaceFolder ? workspaceFolder.uri.fsPath : '/');

        if (!path.isAbsolute(filePathOrDirPath)) {
            filePathOrDirPath = path.join(baseDir, filePathOrDirPath);
        }

        const uri = vscode.Uri.file(filePathOrDirPath);

        try {
            const stat = await vscode.workspace.fs.stat(uri);
            const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
            if (isDirectory) {
                dirname = filePathOrDirPath;
                // Yield directory if type is 'all' or 'directory'
                if (completionType === 'all' || completionType === 'directory') {
                    items.push({
                        detail: "Target directory: " + path.basename(filePathOrDirPath) + "/",
                        label: filePathOrDirPath,
                        buttons: [ { iconPath: vscode.ThemeIcon.Folder } ]
                    });
                }
            } else {
                // Yield file only if type is 'all' or 'file'
                if (completionType === 'all' || completionType === 'file') {
                    items.push({
                        detail: "Target file: " + path.basename(filePathOrDirPath),
                        label: filePathOrDirPath,
                        buttons: [ { iconPath: vscode.ThemeIcon.File } ]
                    });
                }
                dirname = path.dirname(filePathOrDirPath);
            }
        } catch {
            // Yield "Create/Rename to" suggestion only if type is 'all' or 'file'
            if (completionType === 'all' || completionType === 'file') {
                items.push({
                    detail: "Create/Rename to: " + path.basename(filePathOrDirPath),
                    label: filePathOrDirPath,
                    buttons: [ { iconPath: vscode.ThemeIcon.File } ] // Keep as file icon for creation
                });
            }
            dirname = path.dirname(filePathOrDirPath);
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(dirname));
            } catch {
                return items;
            }
        }        try {
            const dirUri = vscode.Uri.file(dirname);
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            const dirItems: vscode.QuickPickItem[] = [];
            const fileItems: vscode.QuickPickItem[] = [];

            for (const [name, type] of entries) {
                const fullpath = path.join(dirname, name);
                if ((type & vscode.FileType.Directory) !== 0) {
                    // Add directory if type is 'all' or 'directory'
                    if (completionType === 'all' || completionType === 'directory') {
                        dirItems.push({
                            label: fullpath, detail: "Open " + name + "/",
                            buttons: [ { iconPath: vscode.ThemeIcon.Folder } ]
                        });
                    }
                } else {
                    // Add file only if type is 'all' or 'file'
                    if (completionType === 'all' || completionType === 'file') {
                        fileItems.push({
                            label: fullpath, detail: "Open " + name,
                            buttons: [ { iconPath: vscode.ThemeIcon.File } ]
                        });
                    }
                }
            }

            return items.concat(dirItems).concat(fileItems);
        } catch (readDirErr) {
            // Ignore errors reading directory
        }
        return items;
    }

    const commandOpen = vscode.commands.registerCommand("extension.dired.open", async () => { // Make the command async
        let initialDir = vscode.workspace.rootPath;
        let initialFile = "";
        const at = vscode.window.activeTextEditor;
        if (at) {
            if (at.document.uri.scheme === DiredProvider.scheme) {
                initialDir = provider.dirname;
            } else {
                const doc = at.document;
                initialDir = path.dirname(doc.fileName);
                initialFile = path.basename(doc.fileName);
            }
        }
        if (!initialDir) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            initialDir = workspaceFolder ? workspaceFolder.uri.fsPath : '/';
        }

        const askDir = configuration.get('askDirectory', true); 
        if (!askDir) {
            if (initialDir) {
                provider.openDir(initialDir, initialFile);
            }
            return; // Exit if not asking for directory
        }

        let selectedPath: string | undefined;

        const useQuickPickInput = configuration.get('useQuickPickInput', false);
        if (useQuickPickInput) {
            selectedPath = await autocompletedInputBox({
                // Pass the completion function with the desired type ('all' for now)
                completion: (input) => pathCompletionFunc(input, 'all'),
                withSelf: (self) => {
                    self.title = "Open Directory or File";
                    self.value = initialDir || '';
                    self.placeholder = "Enter path to open";
                    // Trigger initial completion asynchronously
                    pathCompletionFunc(self.value, 'all').then(items => self.items = items);
                },
            });
        } else {
            // Use the original showInputBox
            selectedPath = await vscode.window.showInputBox({
                value: initialDir,
                valueSelection: initialDir ? [initialDir.length, initialDir.length] : undefined,
                prompt: "Directory or file path to open"
            });
        }

        if (!selectedPath) {
            return; // User cancelled
        }

        try {
            const uri = vscode.Uri.file(selectedPath);
            const stat = await vscode.workspace.fs.stat(uri);
            const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
            const isFile = (stat.type & vscode.FileType.File) !== 0;
            if (isDirectory) {
                await provider.openDir(selectedPath, initialFile);
            } else if (isFile) {
                const f = new FileItem(selectedPath, "", null, false, true); // Incomplete FileItem just to get URI.
                const uri = f.uri;
                if (uri) {
                    await provider.showFile(uri);
                }
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error accessing path ${selectedPath}: ${err.message}`);
        }
    });

    const commandEnter = vscode.commands.registerCommand("extension.dired.enter", async () => {
        provider.enter();
    });
    const commandToggleDotFiles = vscode.commands.registerCommand("extension.dired.toggleDotFiles", () => {
        provider.toggleDotFiles();
    });

    const commandToggleSort = vscode.commands.registerCommand("extension.dired.toggleSort", () => {
        provider.toggleSort();
    });

    const commandCreateDir = vscode.commands.registerCommand("extension.dired.createDir", async () => {
        let dirName = await vscode.window.showInputBox({ prompt: "Directory name" });
        if (!dirName) {
            return;
        }
        await provider.createDir(dirName);
    });

    const commandRename = vscode.commands.registerCommand("extension.dired.rename", async () => {
        const selectedItems = provider.getSelectedItems();
        const configuration = vscode.workspace.getConfiguration('dired');
        const useQuickPickInput = configuration.get('useQuickPickInput', false);
        const setInitialPathInInput = configuration.get('setInitialPathInInput', true);

        if (selectedItems.length > 1) {
            // Multiple items selected: Move to directory
            let targetDir: string | undefined;
            const initialDirValue = provider.dirname || '';

            if (useQuickPickInput) {
                targetDir = await autocompletedInputBox({
                    // Only show directories for completion
                    completion: (input) => pathCompletionFunc(input, 'directory'),
                    withSelf: (self) => {
                        self.title = `Move ${selectedItems.length} items to Directory`;
                        self.value = initialDirValue;
                        self.placeholder = "Enter target directory path";
                        pathCompletionFunc(self.value, 'directory').then(items => self.items = items);
                    }
                });
            } else {
                targetDir = await vscode.window.showInputBox({
                    value: initialDirValue,
                    prompt: `Enter target directory path to move ${selectedItems.length} items`
                });
            }

            if (targetDir) {
                // Call a new provider method for moving multiple items (to be implemented)
                provider.moveMultiple(targetDir, selectedItems);
            }
        } else {
            // Single item (or cursor position): Original rename/move behavior
            let newName: string | undefined;
            const currentPath = provider.getPathUnderCursor();
            // Determine initial value based on the setting
            const initialValue = setInitialPathInInput ? (currentPath || provider.dirname || '') : '';

            if (useQuickPickInput) {
                newName = await autocompletedInputBox({
                    // Pass the completion function with the desired type ('all' for now)
                    completion: (input) => pathCompletionFunc(input, 'all'),
                    withSelf: (self) => {
                        self.title = "Rename/Move";
                        self.value = initialValue; // Use determined initial value
                        self.placeholder = "Enter new name or path";
                        pathCompletionFunc(self.value, 'all').then(items => self.items = items);
                    }
                });
            } else {
                newName = await vscode.window.showInputBox({
                    value: initialValue, // Use determined initial value
                    prompt: "Enter new name or path for the item under cursor"
                });
            }

            if (newName) {
                provider.rename(newName);
            }
        }
    });

    const commandCopy = vscode.commands.registerCommand("extension.dired.copy", async () => {
        const selectedItems = provider.getSelectedItems();
        const useQuickPickInput = configuration.get('useQuickPickInput', false);
        const setInitialPathInInput = configuration.get('setInitialPathInInput', true);

        if (selectedItems.length > 1) {
            // Multiple items selected: Copy to directory
            let targetDir: string | undefined;
            const initialDirValue = provider.dirname || '';

            if (useQuickPickInput) {
                targetDir = await autocompletedInputBox({
                    // Only show directories for completion
                    completion: (input) => pathCompletionFunc(input, 'directory'),
                    withSelf: (self) => {
                        self.title = `Copy ${selectedItems.length} items to Directory`;
                        self.value = initialDirValue;
                        self.placeholder = "Enter target directory path";
                        pathCompletionFunc(self.value, 'directory').then(items => self.items = items);
                    }
                });
            } else {
                targetDir = await vscode.window.showInputBox({
                    value: initialDirValue,
                    prompt: `Enter target directory path to copy ${selectedItems.length} items`
                });
            }

            if (targetDir) {
                provider.copyMultiple(targetDir, selectedItems);
            }
        } else {
            // Single item (or cursor position): Original copy behavior
            let newName: string | undefined;
            const currentPath = provider.getPathUnderCursor();
            const initialValue = setInitialPathInInput ? (currentPath || provider.dirname || '') : '';

            if (useQuickPickInput) {
                newName = await autocompletedInputBox({
                    // Allow all types for single item copy
                    completion: (input) => pathCompletionFunc(input, 'all'),
                    withSelf: (self) => {
                        self.title = "Copy";
                        self.value = initialValue;
                        self.placeholder = "Enter destination name or path";
                        pathCompletionFunc(self.value, 'all').then(items => self.items = items);
                    }
                });
            } else {
                newName = await vscode.window.showInputBox({
                    value: initialValue,
                    prompt: "Enter destination name or path for the item under cursor"
                });
            }

            if (newName) {
                provider.copy(newName);
            }
        }
    });

    const commandDelete = vscode.commands.registerCommand("extension.dired.delete", async () => { // Make async for potential multiple deletions
        const selectedItems = provider.getSelectedItems();

        if (selectedItems.length > 1) {
            // Multiple items selected
            const confirmation = await vscode.window.showInformationMessage(`Delete ${selectedItems.length} selected items?`, { modal: true }, "Yes", "No");
            if (confirmation === "Yes") {
                await provider.deleteMultiple(selectedItems); // Call the new method
            }
        } else {
            // Single item or no selection (delete item under cursor)
            const fileToDelete = provider.getPathUnderCursor(); // Get path for confirmation message
            const baseName = fileToDelete ? path.basename(fileToDelete) : "this item";
            const confirmation = await vscode.window.showInformationMessage(`Delete ${baseName}?`, { modal: true }, "Yes", "No");
            if (confirmation === "Yes") {
                await provider.delete(); // Use existing single delete method
            }
        }
    });

    const commandGoUpDir = vscode.commands.registerCommand("extension.dired.goUpDir", () => {
        provider.goUpDir();
    });
    const commandRefresh = vscode.commands.registerCommand("extension.dired.refresh", () => {
        provider.reload();
    });
    const commandSelect = vscode.commands.registerCommand("extension.dired.select", () => {
        provider.select();
    });
    const commandUnselect = vscode.commands.registerCommand("extension.dired.unselect", () => {
        provider.unselect();
    });
    const commandUnselectAll = vscode.commands.registerCommand("extension.dired.unselectAll", () => {
        provider.unselectAll();
    });    const commandClose = vscode.commands.registerCommand("extension.dired.close", () => {
        vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });    const commandPathLevelUp = vscode.commands.registerCommand("extension.dired.pathLevelUp", () => {
        const quickPick = getCurrentQuickPick();
        if (quickPick) {
            const currentValue = quickPick.value;
            const newValue = removePathLevel(currentValue);
            quickPick.value = newValue;
            // onDidChangeValue event will automatically fire and update completion candidates
        }
    });

    const commandCreateFile = vscode.commands.registerCommand("extension.dired.createFile", async () => {
        // Define a wrapper for the specific completion logic if needed, or pass type directly
        const completionForCreate = (input: string) => pathCompletionFunc(input, 'all'); // Use 'all' for now

        function processSelf(self: vscode.QuickPick<vscode.QuickPickItem>) {
            self.placeholder = "Create File or Open Path" // Adjusted placeholder
        }
        let fileName = await autocompletedInputBox(
            {
                completion: completionForCreate,
                withSelf: (self) => {
                    processSelf(self);
                    // Trigger initial completion asynchronously
                    completionForCreate(self.value).then(items => self.items = items);
                }
            });

        // Check if fileName is defined (not cancelled)
        if (fileName) {
            vscode.window.showInformationMessage(fileName);
            let isDirectory = false;

            const fileUri = vscode.Uri.file(fileName);
            try {
                let stat = await vscode.workspace.fs.stat(fileUri);
                if ((stat.type & vscode.FileType.Directory) !== 0)
                    isDirectory = true;
            }
            catch {
                const parentUri = vscode.Uri.file(path.dirname(fileName));
                await vscode.workspace.fs.createDirectory(parentUri);
                await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(0));
            }

            if (isDirectory) {
                provider.openDir(fileName)
            } else {
                await provider.createFile(fileName)
            }
        }
        // If fileName is undefined (cancelled), do nothing.
    });    context.subscriptions.push(
        provider,
        commandOpen,
        commandEnter,
        commandToggleDotFiles,
        commandToggleSort, // Add this line
        commandCreateDir,
        commandCreateFile,
        commandRename,
        commandCopy,
        commandGoUpDir,
        commandRefresh,
        commandClose,
        commandDelete,
        commandSelect,
        commandUnselect,
        commandUnselectAll,
        commandPathLevelUp,
        providerRegistrations
    );

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.uri.scheme === DiredProvider.scheme) {
            editor.options = {
                cursorStyle: vscode.TextEditorCursorStyle.Block,
            };
            vscode.commands.executeCommand('setContext', 'dired.open', true);
        } else {
            vscode.commands.executeCommand('setContext', 'dired.open', false);
        }
    });

    return {
        DiredProvider: provider,
    };
}
