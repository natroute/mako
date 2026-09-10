import { type TypedMsExpr, type Type, type PrimitiveType, type MsExpr, structSep0 } from './index.ts';
import {
    Text, Call, Concat, Escaped, Param, IntrinsicCall,
    join, error, stringifyType as st,
    typeEqual
} from './util.ts';

// should never end up in a stacktrace, only to be rethrown as a compile error
export class BuiltinError extends Error {};

type Builtin = (...args: TypedMsExpr[]) => TypedMsExpr;
export const builtins = new Map<string, Builtin>();

function exactly<T extends any[]>(array: T, n: number): T {
    if (array.length !== n) {
        throw new Error();
    }
    return array;
}

builtins.set('..', (...args) => {
    if (!args.every((arg) => arg.type.kind === 'string')) {
        throw new BuiltinError('all arguments to .. must be numbers');
    }
    return {
        value: Concat(...args.map(arg => arg.value)),
        type: { kind: 'string' },
    };
});

const numberOpFactory = (
    msFunc: string,
    typeKind: PrimitiveType = 'number',
    negate: boolean = false,
) => (...args: TypedMsExpr[]): TypedMsExpr => {
    const [arg1, arg2] = exactly(args, 2);
    if (arg1.type.kind !== 'number' || arg2.type.kind !== 'number') {
        throw new BuiltinError(`arguments must be numbers (got ${st(arg1.type)} and ${st(arg2.type)})`);
    }

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
    const [arg1, arg2] = exactly(args, 2);
    if (arg1.type !== arg2.type) {
        throw new BuiltinError(`arguments for == must be of the same type (got ${st(arg1.type)} and ${st(arg2.type)})`);
    }
    if (arg1.type.kind === 'list') {
        throw new BuiltinError('cannot compare lists');
    }
    return {
        value: Call('equal', arg1.value, arg2.value),
        type: { kind: 'boolean' },
    };
});

function toString_(arg: TypedMsExpr): MsExpr {
    const type = arg.type;
    const { kind } = type;
    if (kind === 'struct') {
        const { fields } = type;
        return Call('replace',
            arg.value,
            Concat('^', join(new Array<string>(fields.size).fill('(.*?)'), structSep0), '$'),
            '{' + [...fields.keys()].map((name, i) => `${name}: \\${i + 1}`).join(', ') + '}',
        );
    }
    else if (kind === 'list' || kind === 'ref') {
        return Concat(`<${kind}: `, arg.value, '>');
    }
    return arg.value;
}

builtins.set('to_string', (...args) => {
    const [arg] = exactly(args, 1);
    return { value: toString_(arg), type: { kind: 'string' } };
});

builtins.set('print', (...args) => {
    return {
        value: IntrinsicCall('print', join(args.map(toString_), ' ')),
        type: { kind: 'void' },
    };
});