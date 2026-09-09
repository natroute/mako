import type { Sexp } from '../sexp';
import {
    asAtom, asString, asList, asBracketList,
    asListWith,
    error,
} from './util';
import {
    type Type, type Def, type Expr,
    FinalParseError,
    ExprNoRange,
    DefNoRange,
} from '.';
import type { Range } from '../common';

const nop = (..._: any) => {};

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

export function parseFile(sexps: Sexp[]): Def[] {
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

    let node: DefNoRange | undefined;

    if (first === 'fn') {
        const [_, name, params, returnType, body] = asListWith(sexp, [
            nop,
            asAtom,
            s => pairs(asList(s)).map(([x, y]) =>
                ({ name: asAtom(x), type: parseType(y) })),
            parseType,
            parseExpr,
        ]);
        node = { type: 'func', name, params, returnType, body };
    }
    else {
        error(firstSexp, 'invalid top-level definition');
    }

    return withRange(node!, sexp.range);
}

function parseType(sexp: Sexp): Type {
    return asAtom(sexp);
}

function parseExpr(sexp: Sexp): Expr {
    const { type, value } = sexp;

    let node: ExprNoRange | undefined;

    if (type === 'bracketList') {
        node = { type: 'progn', body: value.map(parseExpr) };
    }
    else if (type === 'list') {
        const [firstSexp, ...rest] = asList(sexp);
        const first = asAtom(firstSexp);
        if (first === 'let' || first === 'set') {
            const [_, varName, value] = asListWith(sexp, [nop, asAtom, parseExpr]);
            node = { type: first, varName, value };
        }
        else if (first === 'if') {
            const clauses = pairs(rest, false).map(([x, y]) => 
                ({ cond: parseExpr(x), body: parseExpr(y) }));

            let elseBody: Expr | undefined;
            if (rest.length % 2 === 1) {
                elseBody = parseExpr(rest.at(-1)!);
            }

            node = { type: 'if', clauses, elseBody };
        }
        else {
            const [_, args] = asListWith(sexp, [nop], parseExpr);
            node = { type: 'call', funcName: first, args };
        }
    }
    else if (type === 'atom') {
        do {
            if (value === 'true' || value === 'false') {
                node = { type: 'literal', value: value === 'true' };
                break;
            }
            const number = Number.parseInt(value);
            if (!Number.isNaN(number)) {
                node = { type: 'literal', value: number };
                break;
            }

            node = { type: 'var', name: value };
        } while (0);
    }
    else if (type === 'string') {
        node = { type: 'literal', value };
    }

    return withRange(node!, sexp.range);
}