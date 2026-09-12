import { BuiltinError } from './builtins.ts';
import type { TypedMsExpr, Type } from './index.ts';
import { typeEqual, stringifyType as st } from './util.ts';

type Tuple<
    T,
    N extends number,
    Acc extends readonly T[] = [],
> =
    Acc['length'] extends N
        ? Acc
        : Tuple<T, N, [...Acc, T]>;

type Slice<
    T extends any[],
    N extends number,
    Acc extends readonly any[] = [],
> =
    Acc['length'] extends N
        ? Acc
        : T extends readonly [infer First, ...infer Rest]
            ? Slice<Rest, N, [...Acc, First]>
            : Tuple<T[number], N>;

export type Filter = (arg: TypedMsExpr) => TypedMsExpr;

export class Expect<T extends TypedMsExpr[]> {
    args: T;

    constructor(args: T) {
        this.args = args;
    }

    length<N extends number>(length: N) {
        if (this.args.length !== length) {
            throw new BuiltinError(`invalid number of arguments (expected ${length}, got ${this.args.length})`);
        }
        return new Expect(this.args as number extends N ? T : Slice<T, N>);
    }

    static validate(args: TypedMsExpr[], i: number, filter: Filter) {
        const arg = args[i];
        try {
            filter(arg);
        }
        catch (e) {
            if (e instanceof BuiltinError) {
                throw new BuiltinError(`argument #${i}: ${e.message}`);
            }
        }
        return arg;
    }

    static readonly kindIs = <K extends Type['kind']>(kind: K) => <E extends TypedMsExpr>(arg: TypedMsExpr) => {
        if (arg.type.kind !== kind) {
            throw new BuiltinError(`invalid type kind (expected ${kind}, got ${arg.type.kind})`);
        }
        return arg as E & { type: { kind: K }};
    };

    static readonly equal = <T extends Type>(type: Type) => <E extends TypedMsExpr>(arg: E) => {
        if (!typeEqual(arg.type, type)) {
            throw new BuiltinError(`invalid type (expected ${type}, got ${arg.type})`);
        }
        return arg as E & { type: T };
    };

    static readonly nop = <E extends TypedMsExpr>(arg: E) => arg;

    each<Fs extends Filter[]>(...filters: Fs) {
        const args = this.length(filters.length).args;
        for (const i of args.keys()) {
            Expect.validate(args, i, filters[i]);
        }
        return new Expect(this.args as {
            [I in keyof Fs]: ReturnType<Fs[I]>;
        });
    }

    every<F extends Filter>(filter: F) {
        for (const i of this.args.keys()) {
            Expect.validate(this.args, i, filter);
        }
        return new Expect(this.args as {
            [I in keyof T]: ReturnType<F>;
        });
    }

    equalTypes() {
        for (const [i, arg] of this.args.entries()) {
            if (i === 0) { continue; }
            if (!typeEqual(arg.type, this.args[0].type)) {
                throw new BuiltinError(
                    `inconsistent type for argument #${i + 1} ` +
                    `(first: ${st(this.args[0].type)}, this: ${st(arg.type)})`
                );
            }
        }
        return new Expect(this.args);
    }
}