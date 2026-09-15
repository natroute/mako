import { BaseCompileError } from '../../index.ts';
import { type Loc, type Range } from '../index.ts';

export class FinalParseError extends BaseCompileError {}

export type TypeNoRange =
    | { kind: 'named', name: string }
    | { kind: 'list', value: Type }
    | { kind: 'struct', fields: { name: string, type: Type }[] }
    | { kind: 'variant', cases: { name: string, type: Type }[] }
    | { kind: 'ref', value: Type };

export type Type = TypeNoRange & { range: Range };

export type DefNoRange =
    | {
        type: 'func',
        name: string;
        params: { name: string, type: Type }[];
        returnType: Type;
        body: Expr;
    }
    | { type: 'typeAlias', name: string, value: Type }
    | { type: 'global', name: string, typeNode: Type }
    | { type: 'namespace', name: string }
    | { type: 'import', path: string };

export type Def = DefNoRange & { range: Range };

export type ExprNoRange =
    | { type: 'progn', body: Expr[] }
    | { type: 'prog1', body: Expr[] }
    | { type: 'if', clauses: { cond: Expr, body: Expr }[], elseBody?: Expr }
    | { type: 'while', cond: Expr, body: Expr }
    | { type: 'match', target: Expr, arms: MatchArm[] }
    | { type: 'forSeq', varName: string, start: Expr, end: Expr, body: Expr }
    | { type: 'call', funcName: string, args: Expr[] }
    | { type: 'literal', value: number | boolean | string }
    | { type: 'let', varName: string, value: Expr }
    | { type: 'declare', varName: string, varType: Type }
    | { type: 'set', varName: string, value: Expr }
    | { type: 'var', name: string }
    | { type: 'attr', target: Expr, name: string }
    | { type: 'struct', target?: Type, fields: { name: string, value: Expr }[] }
    | { type: 'variant', target?: Type, case: string, value: Expr }
    | { type: 'list', itemType?: Type, items: Expr[] }
    | { type: 'cast', value: Expr, newType: Type };

export type Expr = ExprNoRange & { range: Range };

export type MatchArm = { pattern?: { case: string, varName?: string }, body: Expr };