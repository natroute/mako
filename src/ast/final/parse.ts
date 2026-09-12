import type { Sexp } from '../sexp/index.ts';
import {
    asAtom, asString, asList, asBracketList,
    asListWith,
    error,
} from './util.ts';
import {
    type Type, type Def, type Expr,
    FinalParseError,
    ExprNoRange,
    DefNoRange,
    TypeNoRange,
} from './index.ts';
import type { Range } from '../index.ts';

const nop = (..._: any) => undefined;

function pairs(items: Sexp[], strict: boolean = true): [Sexp, Sexp][] {
    if (strict && items.length % 2 === 1) {
        error({
            start: items[0].range.start,
            end: items.at(-1)!.range.end
        }, 'expected an even number of items');
    }

    const result: [Sexp, Sexp][] = [];
    for (let i = 0; i < items.length - 1; i += 2) {
        result.push([items[i], items[i + 1]]);
    }
    return result;
}

export function parse(sexps: Sexp[]): Def[] {
    return sexps.map(parseDef);
}

function withRange<T>(node: T, range: Range): T & { range: Range } {
    const result = node as T & { range: Range };
    result.range = range;
    return result;
}

function parseDef(sexp: Sexp): Def {
    const [firstSexp] = asList(sexp);
    const first = asAtom(firstSexp);

    let result: DefNoRange | undefined;

    if (first === 'fn') {
        const [_, name, params, returnType, body] = asListWith(sexp, [
            nop,
            asAtom,
            s => pairs(asList(s)).map(([x, y]) =>
                ({ name: asAtom(x), type: parseType(y) })),
            parseType,
            parseExpr,
        ]);
        result = { type: 'func', name, params, returnType, body };
    }
    else if (first === 'type') {
        const [_, name, value] = asListWith(sexp, [nop, asAtom, parseType]);
        result = { type: 'typeAlias', name, value };
    }
    else if (first === 'global') {
        const [_, name, typeNode] = asListWith(sexp, [nop, asAtom, parseType]);
        result = { type: 'global', name, typeNode };
    }
    else {
        error(firstSexp, 'invalid top-level definition');
    }

    return withRange(result, sexp.range);
}

function parseType(sexp: Sexp): Type {
    const { type, value } = sexp;

    let result: TypeNoRange;

    if (type === 'atom') {
        result = { kind: 'named', name: value };
    }
    else if (type === 'list') {
        const [firstSexp] = asList(sexp);
        const first = asAtom(firstSexp);
        if (first === 'struct') {
            const fields = pairs(value.slice(1), true).map(([x, y]) =>
                ({ name: asAtom(x), type: parseType(y) }));
            result = { kind: 'struct', fields };
        }
        else if (first === 'list') {
            const [_, value] = asListWith(sexp, [nop, parseType]);
            result = { kind: 'list', value };
        }
        else {
            error(firstSexp, 'invalid type');
        }
    }
    else {
        error(sexp, 'expected atom or list');
    }

    return withRange(result, sexp.range);
}

function parseExpr(sexp: Sexp): Expr {
    const { type, value } = sexp;

    let result: ExprNoRange | undefined;

    if (type === 'bracketList') {
        result = { type: 'progn', body: value.map(parseExpr) };
    }
    else if (type === 'list') {
        const [firstSexp, ...rest] = asList(sexp);
        const first = asAtom(firstSexp);
        if (first === 'let' || first === 'set') {
            const [_, varName, value] = asListWith(sexp, [nop, asAtom, parseExpr]);
            result = { type: first, varName, value };
        }
        else if (first === 'if') {
            const clauses = pairs(rest, false).map(([x, y]) => 
                ({ cond: parseExpr(x), body: parseExpr(y) }));

            let elseBody = rest.length % 2
                ? parseExpr(rest.at(-1)!)
                : undefined;

            result = { type: 'if', clauses, elseBody };
        }
        else if (first === 'for') {
            const [_, varName, start, end, body] = asListWith(sexp, [nop, asAtom, parseExpr, parseExpr, parseExpr]);
            result = { type: 'forSeq', varName, start, end, body };
        }
        else if (first === 'new') {
            const [[_, target], fieldSexps] = asListWith(sexp, [nop, parseType], x => x);

            const fields = pairs(fieldSexps, true).map(([x, y]) =>
                ({ name: parseStructExprFieldName(x), value: parseExpr(y) }));

            result = { type: 'struct', target, fields };
        }
        else if (first === 'list') {
            if (rest.length === 0) {
                error(sexp, 'a list initializer must have at least one item; use list* for an empty list');
            }
            result = { type: 'list', items: rest.map(parseExpr) };
        }
        else if (first === 'list*') {
            const [_, itemType] = asListWith(sexp, [nop, parseType]);
            result = { type: 'emptyList', itemType };
        }
        else {
            const [_, args] = asListWith(sexp, [nop], parseExpr);
            result = { type: 'call', funcName: first, args };
        }
    }
    else if (type === 'atom') {
        do {
            if (value === 'true' || value === 'false') {
                result = { type: 'literal', value: value === 'true' };
                break;
            }

            const number = Number.parseInt(value);
            if (!Number.isNaN(number)) {
                result = { type: 'literal', value: number };
                break;
            }

            if (value.includes('.')) {
                let [target, ...names] = value.split('.');
                // XXX: this fucking sucks
                // also the ranges are inaccurate
                result = names.reduce<Expr>(
                    (a, b) => ({ type: 'attr', target: a, name: b, range: sexp.range }),
                    { type: 'var', name: target, range: sexp.range }
                );
                break;
            }

            result = { type: 'var', name: value };
        } while (0);
    }
    else if (type === 'string') {
        result = { type: 'literal', value };
    }

    return withRange(result, sexp.range);
}

function parseStructExprFieldName(sexp: Sexp): string {
    const value = asAtom(sexp);
    if (!value.startsWith(':')) {
        error(sexp, 'field names in struct initializers must be preceded by a colon');
    }
    return value.slice(1);
}