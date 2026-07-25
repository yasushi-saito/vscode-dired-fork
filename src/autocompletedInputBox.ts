import * as vscode from 'vscode';

// Global management of QuickPick instances
let currentActiveQuickPick: vscode.QuickPick<vscode.QuickPickItem> | null = null;

export function getCurrentQuickPick(): vscode.QuickPick<vscode.QuickPickItem> | null {
    return currentActiveQuickPick;
}

// Path level removal logic
export function removePathLevel(path: string): string {
    if (!path.includes('/')) {
        return ''; // Return empty string if no '/' found
    }

    // Remove trailing '/' before processing
    let trimmedPath = path.endsWith('/') ? path.slice(0, -1) : path;

    if (trimmedPath === '') {
        return ''; // Return empty string if already empty
    }

    if (trimmedPath === '/') {
        return ''; // Return empty string for root directory
    }

    const lastSlashIndex = trimmedPath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
        return ''; // Return empty string if no '/' found
    }

    if (lastSlashIndex === 0) {
        return '/'; // Return root for paths at root level
    }

    return trimmedPath.substring(0, lastSlashIndex + 1);
}

export function defaultFinishCondition(self: vscode.QuickPick<vscode.QuickPickItem>) {
    if (self.selectedItems.length == 0 || self.selectedItems[0].label == self.value) {
        return true;
    }
    else {
        self.value = self.selectedItems[0].label;
        return false;
    }
}

export async function autocompletedInputBox<T>(
    arg: {
        completion: (userinput: string) => Thenable<Iterable<vscode.QuickPickItem>> | Iterable<vscode.QuickPickItem> | Promise<Iterable<vscode.QuickPickItem>>,
        withSelf?: undefined | ((self: vscode.QuickPick<vscode.QuickPickItem>) => any),
        stopWhen?: undefined | ((self: vscode.QuickPick<vscode.QuickPickItem>) => boolean)
    }) {
    const completionFunc = arg.completion;
    const processSelf = arg.withSelf;

    let finishCondition = defaultFinishCondition;
    if (arg.stopWhen != undefined)
        finishCondition = defaultFinishCondition


    const quickPick = vscode.window.createQuickPick();
    quickPick.canSelectMany = false;

    // Register QuickPick instance globally and set context key
    currentActiveQuickPick = quickPick;
    vscode.commands.executeCommand('setContext', 'autocompletedInputBox.active', true);

    let disposables: vscode.Disposable[] = [];
    let result: string | undefined = undefined; // Initialize result to undefined
    let accepted = false; // Flag to track if accepted via Enter

    if (processSelf !== undefined)
        processSelf(quickPick);

    let makeTask = () => new Promise<string | undefined>(resolve => { // Return type includes undefined
        disposables.push(
            quickPick.onDidChangeValue(async directoryOrFile => {
                const items = await completionFunc(quickPick.value);
                quickPick.items = Array.from(items);
                return 0;
            }),
            quickPick.onDidAccept(() => {
                if (finishCondition(quickPick)) {
                    result = quickPick.value;
                    accepted = true; // Mark as accepted
                    quickPick.hide();
                    // Don't resolve here, let onDidHide handle resolution
                }
            }),
            quickPick.onDidHide(() => {
                // Clean up QuickPick instance and disable context key
                currentActiveQuickPick = null;
                vscode.commands.executeCommand('setContext', 'autocompletedInputBox.active', false);

                quickPick.dispose();
                if (accepted) {
                    resolve(result); // Resolve with the accepted value
                } else {
                    resolve(undefined); // Resolve with undefined if cancelled (e.g., Esc)
                }
            })
        );
        quickPick.show();
    });

    try {
        result = await makeTask(); // Assign the resolved value (string or undefined)
    }
    finally {
        disposables.forEach(d => d.dispose());
    }
    return result; // Return the final result (string or undefined)
}
