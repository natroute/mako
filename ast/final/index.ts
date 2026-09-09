import { type Loc, type Range, ParseError } from '../common';

export class FinalParseError extends Error {
    range: Range;
    parserMessage: string;

    constructor(range: Range, message: string) {
        super(`at line ${range.start.line}: ${message}`);
        this.range = range;
        this.parserMessage = message;
        this.name = 'FinalParseError';
    }
}

export type Type = string;

export type DefNoRange =
    | {
        type: 'func',
        name: string;
        params: { name: string, type: Type }[];
        returnType: Type;
        body: Expr;
    };

export type Def = DefNoRange & { range: Range };

export type ExprNoRange =
    | { type: 'progn', body: Expr[] }
    | { type: 'if', clauses: { cond: Expr, body: Expr }[], elseBody?: Expr }
    | { type: 'call', funcName: string, args: Expr[] }
    | { type: 'literal', value: number | bigint | boolean | string }
    | { type: 'let', varName: string, value: Expr }
    | { type: 'set', varName: string, value: Expr }
    | { type: 'var', name: string };

export type Expr = ExprNoRange & { range: Range };