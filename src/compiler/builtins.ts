import { Expect } from './expect.ts';
import { type TypedMsExpr, type Type, type PrimitiveType, type MsExpr, structSep0 } from './index.ts';
import {
    Text, Call, Concat, Escaped, Param, IntrinsicCall,
    join, error, 
    typeEqual
} from './util.ts';

// should never end up in a stacktrace, only to be rethrown as a compile error
export class BuiltinError extends Error {};

export type Builtin = (...args: TypedMsExpr[]) => TypedMsExpr;
export const builtins = new Map<string, Builtin>();
export const typedBuiltins: [(type: Type) => boolean, Map<string, Builtin>][] = [];

function exactly<T extends any[]>(array: T, n: number): T {
    if (array.length !== n) {
        throw new Error();
    }
    return array;
}

function expect(args: TypedMsExpr[]) {
    return new Expect(args);
}

builtins.set('..', (...args) => {
    const items = expect(args).every(Expect.kindIs('string')).args;
    return {
        value: Concat(...items.map(item => item.value)),
        type: { kind: 'string' },
    };
});

const numberOpFactory = (
    msFunc: string,
    typeKind: PrimitiveType = 'number',
    negate: boolean = false,
) => (...args: TypedMsExpr[]): TypedMsExpr => {
    const [arg1, arg2] = expect(args).each(Expect.kindIs('number'), Expect.kindIs('number')).args;

    let value = Call(msFunc, arg1.value, arg2.value);
    if (negate) { value = Call('not', value); }
    return { value, type: { kind: typeKind } };
}

builtins.set('+',  numberOpFactory('add'));
builtins.set('-',  numberOpFactory('subtract'));
builtins.set('*',  numberOpFactory('multiply'));
builtins.set('/',  numberOpFactory('divide'));

builtins.set('<',  numberOpFactory('less', 'boolean'));
builtins.set('>',  numberOpFactory('greater', 'boolean'));
builtins.set('<=', numberOpFactory('greater', 'boolean', true));
builtins.set('>=', numberOpFactory('less', 'boolean', true));

builtins.set('==', (...args) => {
    const [arg1, arg2] = expect(args).length(2).equalTypes().args;
    if (arg1.type.kind === 'list') {
        throw new BuiltinError('cannot compare lists');
    }
    return {
        value: Call('equal', arg1.value, arg2.value),
        type: { kind: 'boolean' },
    };
});

function toString_(value: TypedMsExpr): MsExpr {
    const type = value.type;
    const { kind } = type;
    if (kind === 'struct') {
        const { fields } = type;
        return Call('replace',
            value.value,
            Concat('^', join(new Array<string>(fields.size).fill('(.*?)'), structSep0), '$'),
            '{' + [...fields.keys()].map((name, i) => `${name}: \\${i + 1}`).join(', ') + '}',
        );
    }
    else if (kind === 'list') {
        return Concat('<list (', Call('load', value.value), ')>');
    }
    else if (kind === 'ref') {
        return Text('<ref>');
    }
    return value.value;
}

builtins.set('to_string', (...args) => {
    const [arg] = expect(args).length(1).args;
    return { value: toString_(arg), type: { kind: 'string' } };
});

builtins.set('print', (...args) => {
    return {
        value: IntrinsicCall('print', join(args.map(toString_), ' ')),
        type: { kind: 'void' },
    };
});

const listBuiltins = new Map<string, Builtin>();
typedBuiltins.push([(type) => type.kind === 'list', listBuiltins]);

listBuiltins.set('push', (...args) => {
    const [list, _] = expect(args).each(Expect.kindIs('list'), Expect.nop).args;
    const item = Expect.validate(args, 1, Expect.equal(list.type.value));
    return {
        value: IntrinsicCall('list_push', list.value, item.value),
        type: { kind: 'void' },
    };
});

listBuiltins.set('length', (...args) => {
    const [list] = expect(args).each(Expect.kindIs('list')).args;
    return {
        value: Call('load', list.value),
        type: { kind: 'number' },
    };
});

listBuiltins.set('get', (...args) => {
    const [list, index] = expect(args).each(Expect.kindIs('list'), Expect.kindIs('number')).args;
    return {
        value: Call('load', Concat(list.value, '.', index.value)),
        type: list.type.value,
    };
});

listBuiltins.set('free', (...args) => {
    const [list] = expect(args).each(Expect.kindIs('list')).args;
    return {
        value: IntrinsicCall('list_free', list.value),
        type: { kind: 'void' },
    };
});