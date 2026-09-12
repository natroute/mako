import { Call } from './util.ts';
import { BaseCompileError } from '../index.ts';

export class CompileError extends BaseCompileError {}

const primitiveTypeArray = ['number', 'string', 'boolean', 'void'] as const;
export type PrimitiveType = (typeof primitiveTypeArray)[number];

export type Type = Readonly<
    | { kind: PrimitiveType }
    | { kind: 'struct', fields: Map<string, StructField>, depth: number }
    | { kind: 'list', value: Type }
    | { kind: 'ref', value: Type }
>;

export type StructField = { index: number, type: Type };

/**
 * A Macrosia expression.
 */
export type MsExpr =
    | { type: 'text', value: string }
    | { type: 'call', target: MsExpr, args: MsExpr[] }
    | { type: 'intrinsicCall', target: string, args: MsExpr[] }
    | { type: 'concat', items: MsExpr[] }
    | { type: 'escaped', body: MsExpr }
    | { type: 'deescaped', body: MsExpr }
    | { type: 'param', index: number };

/**
 * A Macrosia expression associated with a type.
 */
export type TypedMsExpr = { value: MsExpr, type: Type };

export type MsExprLike = MsExpr | string;

export type Func = {
    mangledName: string;
    params: { name: string, type: Type }[];
    returnType: Type;
};

export type Var = {
    mangledName: string;
    type: Type;
};

export type Global = {
    
};

export const primitiveTypes = new Set<string>(primitiveTypeArray);

export function isTypeNamePrimitive(name: string): name is PrimitiveType {
    return primitiveTypes.has(name);
}

export function structSepFromDepth(depth: number): string {
    if (depth >= 32) {
        throw new Error('you nested a struct so deep i ran out of unicode noncharacters for it');
    }
    return String.fromCharCode(0xfdd0 + depth);
}
export const structSep0 = structSepFromDepth(0);