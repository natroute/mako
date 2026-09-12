import { type MsExprLike, type MsExpr, type Type, CompileError } from './index.ts';
import { Range } from '../ast/index.ts';

export function error(range: { range: Range } | Range, message: string): never {
    if ('range' in range) { range = range.range; }
    throw new CompileError(range, message);
}

export function walk(expr: MsExpr, fn: (expr: MsExpr) => void) {
    function inner(expr: MsExpr) {
        fn(expr);
        const { type } = expr;
        if (type === 'call') {
            inner(expr.target);
            for (const arg of expr.args) { inner(arg); }
        }
        if (type === 'intrinsicCall') {
            for (const arg of expr.args) { inner(arg); }
        }
        if (type === 'concat') {
            for (const item of expr.items) { inner(item); }
        }
        if (type === 'escaped') {
            inner(expr.body);
        }
    }
    return inner(expr);
}

const convert = (exprLike: MsExprLike): MsExpr =>
    typeof exprLike === 'string' ? Text(exprLike) : exprLike;

export const Text = (value: string): MsExpr =>
    ({ type: 'text', value });

export const Call = (target: MsExprLike, ...args: MsExprLike[]): MsExpr =>
    ({ type: 'call', target: convert(target), args: args.map(convert) });

export const IntrinsicCall = (target: string, ...args: MsExprLike[]): MsExpr =>
    ({ type: 'intrinsicCall', target, args: args.map(convert) });

export const Concat = (...items: MsExprLike[]): MsExpr =>
    ({ type: 'concat', items: items.map(convert) });

export const Escaped = (body: MsExprLike): MsExpr =>
    ({ type: 'escaped', body: convert(body) });

export const Deescaped = (body: MsExprLike): MsExpr =>
    ({ type: 'deescaped', body: convert(body) });

export const Param = (index: number): MsExpr =>
    ({ type: 'param', index });

export function join(exprs: MsExprLike[], sep: MsExprLike): MsExpr {
    sep = convert(sep);

    const items: MsExpr[] = [];
    for (const [i, expr] of exprs.entries()) {
        if (i !== 0) { items.push(sep); }
        items.push(convert(expr));
    }

    return { type: 'concat', items };
}

export function stringifyType(type: Type): string {
    const { kind } = type;
    if (kind === 'struct') {
        return (
            '(struct ' +
            [...type.fields]
                .map(([name, { type }]) => `${name} ${stringifyType(type)}`)
                .join(' ') +
            ')'
        );
    }
    else if (kind === 'list') {
        return `(list ${stringifyType(type.value)})`;
    }
    else if (kind === 'ref') {
        return `(ref ${stringifyType(type.value)})`;
    }
    
    // primitive
    return kind;
}

export function typeEqual(a: Type, b: Type): boolean {
    const { kind } = a;
    if (kind !== b.kind) { return false; }

    if (kind === 'struct') {
        b = b as typeof a;
        if (a.fields.size !== b.fields.size) { return false; }

        return [...a.fields].every(([name, field]) => {
            b = b as typeof a;
            const other = b.fields.get(name);
            return (
                other !== undefined &&
                field.index === other.index &&
                typeEqual(field.type, other.type)
            );
        });
    }
    else if (kind === 'list' || kind === 'ref') {
        b = b as typeof a;
        return typeEqual(a.value, b.value);
    }

    // primitive
    return true;
}
