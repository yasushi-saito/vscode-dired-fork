import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
        const extensionTestsPath = path.resolve(__dirname, 'index');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [path.resolve(extensionDevelopmentPath)]
        });
    } catch (err) {
        console.error('Failed to run extension tests', err);
        process.exit(1);
    }
}

main();
