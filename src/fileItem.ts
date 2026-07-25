'use strict';

export const DIRED_SCHEME = 'dired';

import * as vscode from 'vscode';
import * as path from 'path-browserify';

export enum SortOrder {
    Alphabetical,
    Mtime,
    Ext,
    Size
}

export default class FileItem {

    constructor(
        private _dirname: string,
        private _filename: string,
        public stat: vscode.FileStat | null, // Use vscode.FileStat
        private _isDirectory: boolean = false,
        private _isFile: boolean = true,
        private _size: number = 0,
        private _month: number = 0,
        private _day: number = 0,
        private _hour: number = 0,
        private _min: number = 0,
        private _modeStr: string | undefined = undefined,
        private _year: number = 1970,
        private _selected: boolean = false) {}

    public static create(dir: string, filename: string, stat: vscode.FileStat) {
        const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
        const isFile = (stat.type & vscode.FileType.File) !== 0;
        const mtime = new Date(stat.mtime);

        let modeStr = isDirectory ? "drwxr-xr-x" : "-rw-r--r--";
        if ('mode' in stat) {
            modeStr = FileItem.statsToModeString(stat);
        }

        const uid = ('uid' in stat) ? (stat as any).uid : 0;
        const gid = ('gid' in stat) ? (stat as any).gid : 0;

        return new FileItem(
            dir,
            filename,
            stat,
            isDirectory,
            isFile,
            stat.size,
            mtime.getMonth()+1,
            mtime.getDate(),
            mtime.getHours(),
            mtime.getMinutes(),
            modeStr,
            mtime.getFullYear(),
            false);
    }

    private static statsToModeString(stats: any): string {
        const isDir = typeof stats.isDirectory === 'function' ? stats.isDirectory() : ((stats.type & vscode.FileType.Directory) !== 0);
        const mode = stats.mode;
        if (typeof mode !== 'number') {
            return isDir ? 'drwxr-xr-x' : '-rw-r--r--';
        }
        let res = isDir ? 'd' : '-';
        res += (mode & 0o400) ? 'r' : '-';
        res += (mode & 0o200) ? 'w' : '-';
        res += (mode & 0o100) ? 'x' : '-';
        res += (mode & 0o040) ? 'r' : '-';
        res += (mode & 0o020) ? 'w' : '-';
        res += (mode & 0o010) ? 'x' : '-';
        res += (mode & 0o004) ? 'r' : '-';
        res += (mode & 0o002) ? 'w' : '-';
        res += (mode & 0o001) ? 'x' : '-';
        return res;
    }

    get uri(): vscode.Uri | null {
        if (path.isAbsolute(this._dirname)) {
            if (this._isDirectory) {
                return vscode.Uri.file(this.path).with({ scheme: DIRED_SCHEME });
            }
            return vscode.Uri.file(this.path);
        }
        return null;
    }

    get path(): string {
        return path.join(this._dirname, this._filename);
    }

    get dirname(): string {
        return this._dirname;
    }

    get fileName(): string {
        return this._filename;
    }

    public line(): string {
        const size = this.pad(this._size, 8, " ");
        const month = this.pad(this._month, 2, "0");
        const day = this.pad(this._day, 2, "0");
        const hour = this.pad(this._hour, 2, "0");
        const min = this.pad(this._min, 2, "0");
        let se = " ";
        if (this._selected) {
            se = "*";
        }
        const currentYear = (new Date()).getFullYear();
        if (this._year !== currentYear) {
            return `${se} ${this._modeStr} ${size} ${month} ${day} ${' ' + this._year} ${this._filename}`;
        } else {
            return `${se} ${this._modeStr} ${size} ${month} ${day} ${hour}:${min} ${this._filename}`;
        }
    }

    public static parseLine(dir: string, line: string): FileItem {
        if (line.length < 34) {
            throw new Error("Line is too short to parse as a FileItem");
        }
        const filename = line.substring(34);
        const sizeStr = line.substring(13, 13 + 8).trim();
        const size = parseInt(sizeStr);
        const monthStr = line.substring(22, 22 + 2);
        const month = parseInt(monthStr);
        const dayStr = line.substring(25, 25 + 2);
        const day = parseInt(dayStr);
        const hourStr = line.substring(28, 28 + 2);
        const hour = parseInt(hourStr);
        const minStr = line.substring(31, 31 + 2);
        const min = parseInt(minStr);

        const isDirectory = line.substring(2, 3) === "d";
        const isFile = line.substring(2, 3) === "-";
        const modeStr = line.substring(2, 12);

        // We don't have year in the parsed line if it is current year,
        // but if it has ':' it is current year, otherwise it is year.
        let year = (new Date()).getFullYear();
        const timeOrYear = line.substring(46, 51);
        if (!timeOrYear.includes(":")) {
            year = parseInt(timeOrYear.trim());
        }

        return new FileItem(
            dir,
            filename,
            null, // We don't have stat when parsing line
            isDirectory,
            isFile,
            size,
            month,
            day,
            hour,
            min,
            modeStr,
            year,
            line.substring(0, 1) === "*"
        );
    }

    private pad(num: number, size: number, char: string): string {
        let s = num + "";
        while (s.length < size) s = char + s;
        return s;
    }

    get isDirectory(): boolean {
        return this._isDirectory;
    }

    get isFile(): boolean {
        return this._isFile;
    }

    get selected(): boolean {
        return this._selected;
    }

    set selected(val: boolean) {
        this._selected = val;
    }

    get isSelected(): boolean {
        return this._selected;
    }

    select(val: boolean) {
        this._selected = val;
    }

    toggleSelect() {
        this._selected = !this._selected;
    }
}
