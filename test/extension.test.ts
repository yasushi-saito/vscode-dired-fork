/// <reference types="node" />

import * as assert from 'assert';
import { getTargetLineForOpenDir } from '../src/provider';

export function runTests(): void {
    const tests: Array<{ name: string; fn: () => void }> = [
        {
            name: 'Something 1',
            fn: () => {
                assert.equal(-1, [1, 2, 3].indexOf(5));
                assert.equal(-1, [1, 2, 3].indexOf(0));
            }
        },
        {
            name: 'uses the initial file row when no saved cursor position exists',
            fn: () => {
                const buffers = [
                    'dir: (Sort: Alphabetical)',
                    '  -rw-r--r-- 1234 07 07 10:00 foo.txt',
                    '  -rw-r--r-- 1234 07 07 10:01 bar.txt'
                ];

                assert.strictEqual(getTargetLineForOpenDir(buffers, 'bar.txt', null, buffers.length), 2);
            }
        }
    ];

    let failures = 0;
    for (const test of tests) {
        try {
            test.fn();
            console.log(`✔ ${test.name}`);
        } catch (error) {
            failures += 1;
            console.error(`✖ ${test.name}`);
            console.error(error);
        }
    }

    if (failures > 0) {
        throw new Error(`${failures} test(s) failed.`);
    }
}