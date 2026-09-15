import { Expect } from './expect.ts';
import { type TypedMsExpr, type Type, type PrimitiveType, type MsExpr, compoundSep0 } from './index.ts';
import {
    Text, Call, Concat, Escaped, Param, IntrinsicCall,
    join, error, 
    typeEqual,
    stringifyType as st
} from './util.ts';

// should never end up in a stacktrace, only to be rethrown as a compile error
export class BuiltinError extends Error {}

export type BuiltinBase = {
    paramTypes: ParamTypes;
    call(...args: TypedMsExpr[]): TypedMsExpr;
};

export type Builtin =
    | BuiltinBase
    | { generic: true, instantiate(type: Type): BuiltinBase };

export type ParamTypes = {
    minCount: number;
    maxCount: number;
    get(index: number): Type | null | undefined;
};

export const builtins = new Map<string, Builtin>();

const makeParams = (types: (Type | null)[], restType?: Type | null): ParamTypes => ({
    minCount: types.length,
    maxCount: restType === undefined ? types.length : Number.MAX_SAFE_INTEGER,
    get: (index) => index < types.length ? types[index] : restType,
});

builtins.set('error', {
    paramTypes: makeParams([{ kind: 'string' }]),
    call: (message) => ({
        value: Call('error', message.value),
        type: { kind: 'void' },
    }),
})

builtins.set('..', {
    paramTypes: makeParams([], { kind: 'string' }),
    call: (...items) => ({
        value: Concat(...items.map(item => item.value)),
        type: { kind: 'string' },
    }),
});

const numberOpFactory = (
    msFunc: string,
    nonBinary: boolean = false, // :3
    returnTypeKind: PrimitiveType = 'number',
    negate: boolean = false,
): Builtin => ({
    paramTypes: nonBinary
        ? makeParams([], { kind: 'number' })
        : makeParams([{ kind: 'number' }, { kind: 'number' }]),

    call(...args) {
        let value = Call(msFunc, ...args.map((arg) => arg.value));
        if (negate) { value = Call('not', value); }
        return { value, type: { kind: returnTypeKind } };
    },
});

builtins.set('+',  numberOpFactory('add', true));
builtins.set('-',  numberOpFactory('subtract'));
builtins.set('*',  numberOpFactory('multiply', true));
builtins.set('/',  numberOpFactory('divide'));

builtins.set('<',  numberOpFactory('less', false, 'boolean'));
builtins.set('>',  numberOpFactory('greater', false, 'boolean'));
builtins.set('<=', numberOpFactory('greater', false, 'boolean', true));
builtins.set('>=', numberOpFactory('less', false, 'boolean', true));

const equalFactory = (negate: boolean): Builtin => ({
    paramTypes: makeParams([null, null]),
    call(arg0, arg1) {
        if (!typeEqual(arg0.type, arg1.type)) {
            throw new BuiltinError('cannot compare values with different types');
        }
        let value = Call('equal', arg0.value, arg1.value);
        if (negate) { value = Call('not', value); }
        return { value, type: { kind: 'boolean' } };
    },
});

builtins.set('==', equalFactory(false));
builtins.set('!=', equalFactory(true));

const andOrFactory = (msFunc: string): Builtin => ({
    paramTypes: makeParams([], { kind: 'boolean' }),
    call: (arg0, arg1) => ({
        value: Call(msFunc, arg0.value, arg1.value),
        type: { kind: 'boolean' },
    }),
});

builtins.set('and', andOrFactory('and'));
builtins.set('or', andOrFactory('or'));

function toString_(value: TypedMsExpr): MsExpr {
    const type = value.type;
    const { kind } = type;
    if (kind === 'struct') {
        const { fields } = type;
        return Call('replace',
            value.value,
            Concat('^', join(new Array<string>(fields.size).fill('(.*?)'), compoundSep0), '$'),
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

builtins.set('to_string', {
    paramTypes: makeParams([null]),
    call: (arg: TypedMsExpr) =>
        ({ value: toString_(arg), type: { kind: 'string' } }),
});

builtins.set('print', {
    paramTypes: makeParams([], null),
    call: (...args) => ({
        value: IntrinsicCall('print', join(args.map(toString_), ' ')),
        type: { kind: 'void' },
    }),
});

builtins.set('string.slice', {
    paramTypes: {
        minCount: 1,
        maxCount: 4,
        get: (index: number) => ([
            { kind: 'string' },
            { kind: 'number' },
            { kind: 'number' },
            { kind: 'number' },
        ] as Type[])[index],
    },
    call: (str, ...rest) => ({
        value: Call('slice', str.value, ...rest.map((arg) => arg.value)),
        type: { kind: 'string' },
    }),
});

builtins.set('string.length', {
    paramTypes: makeParams([{ kind: 'string' }]),
    call: (str) => ({
        value: Call('len', str.value),
        type: { kind: 'number' },
    }),
})

builtins.set('string.ord', {
    paramTypes: makeParams([{ kind: 'string' }]),
    call: (str) => ({
        value: Call('ord', str.value),
        type: { kind: 'number' },
    }),
})

builtins.set('string.chr', {
    paramTypes: makeParams([{ kind: 'number' }]),
    call: (codepoint) => ({
        value: Call('chr', codepoint.value),
        type: { kind: 'string' },
    }),
})

const replaceFactory = (msFunc: string): Builtin => ({
    paramTypes: makeParams([{ kind: 'string' }], { kind: 'string' }),
    call(str, ...rest) {
        if (rest.length % 2 !== 0) {
            throw new BuiltinError('expected an even number of substitution arguments');
        }
        return {
            value: Call(msFunc, str.value, ...rest.map((arg) => arg.value)),
            type: { kind: 'string' },
        };
    },
});

builtins.set('string.sreplace', replaceFactory('sreplace'));
builtins.set('string.replace', replaceFactory('ureplace'));

const makeListBuiltin = (builtin: (type: Type & { kind: 'list' }) => BuiltinBase): Builtin => ({
    generic: true,
    instantiate(type) {
        if (type.kind !== 'list') {
            throw new BuiltinError(`expected list as first argument (got ${st(type)} instead)`);
        }
        return builtin(type);
    },
});

builtins.set('list.push', makeListBuiltin((type) => ({
    paramTypes: makeParams([type.value]),
    call: (list, item) => ({
        value: IntrinsicCall('list_push', list.value, item.value),
        type: { kind: 'void' },
    }),
})));

builtins.set('list.length', makeListBuiltin(() => ({
    paramTypes: makeParams([]),
    call: (list) => ({
        value: Call('load', list.value),
        type: { kind: 'number' },
    }),
})));

builtins.set('list.get', makeListBuiltin((type) => ({
    paramTypes: makeParams([{ kind: 'number' }]),
    call: (list, index) => ({
        value: Call('load', Concat(list.value, '.', index.value)),
        type: type.value,
    }),
})));

builtins.set('list.free', makeListBuiltin(() => ({
    paramTypes: makeParams([]),
    call: (list) => ({
        value: IntrinsicCall('list_free', list.value),
        type: { kind: 'void' },
    }),
})));