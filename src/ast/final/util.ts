import type { Sexp, SexpType, SexpValue, AnySexpValue } from '../sexp/index.ts';
import type { Range } from '../index.ts';
import { FinalParseError } from './index.ts';

export function error(range: { range: Range } | Range, message: string): never {
    if ('range' in range) { range = range.range; }
    throw new FinalParseError(range, message);
}

export function as<T extends SexpType>(sexp: Sexp, type: T): SexpValue<T> {
    if (sexp.type !== type) {
        error(sexp, `expected ${type}, got ${sexp.type}`);
    }
    return sexp.value as any;
}

export const asAtom = (sexp: Sexp): string => as(sexp, 'atom');
export const asString = (sexp: Sexp): string => as(sexp, 'string');
export const asList = (sexp: Sexp): Sexp[] => as(sexp, 'list');
export const asBracketList = (sexp: Sexp): Sexp[] => as(sexp, 'bracketList');

//#region asListWith

// XXX: this fucking sucks

type Callback = (sexp: Sexp) => any;
type FirstReturn<First extends readonly ((sexp: Sexp) => any)[]> = {
    -readonly [I in keyof First]: ReturnType<First[I]>
};

export function asListWith<
    const First extends readonly Callback[],
> (
    sexp: Sexp, first: First,
): FirstReturn<First>;

export function asListWith<
    const First extends readonly Callback[],
    Rest extends Callback,
>(
    sexp: Sexp, first: First, rest: Rest,
): [
    FirstReturn<First>,
    Rest extends (sexp: Sexp) => infer R ? R[] : never,
];

export function asListWith<
    const First extends readonly Callback[],
    Rest extends Callback | void,
>(
    sexp: Sexp, first: First, rest?: Rest,
) {
    const items = asList(sexp);
    if (rest === undefined) {
        if (items.length !== first.length) {
            error(sexp, `expected ${first.length} elements, got ${items.length}`);
        }
    }
    else {
        if (items.length <= first.length) {
            error(sexp, `expected at least ${first.length} elements, got ${items.length}`);
        }
    }

    const result = first.map((fn, i) => fn(items[i]));
    if (rest === undefined) {
        return result as any;
    } else {
        return [result, items.slice(first.length).map(rest)] as any;
    }
}

//#endregion