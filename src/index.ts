import type { Range } from './ast/index.ts';

export class BaseCompileError extends Error {
    range: Range;
    realMessage: string;

    constructor(range: Range, message: string) {
        super(`at line ${range.end.line}: ${message}`);
        this.name = this.constructor.name;
        this.range = range;
        this.realMessage = message;
    }
}