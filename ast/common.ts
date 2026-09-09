export type Range = Readonly<{ start: Loc, end: Loc }>;
export type Loc = Readonly<{ line: number, column: number }>;

export class ParseError extends Error {
    loc: Loc;

    constructor(loc: Loc) {
        super(`line ${loc.line}, column ${loc.column}`);
        this.name = 'ParseError';
        this.loc = loc;
    }
}