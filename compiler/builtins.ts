import type { TypedMsExpr } from '.';
import { Text, Call, Concat, Escaped, Param } from './util';

type Builtin = (...args: TypedMsExpr[]) => TypedMsExpr;
export const builtins = new Map<string, Builtin>();

function exactly<T extends any[]>(array: T, n: number): T {
    if (array.length !== n) {
        throw new Error();
    }
    return array;
}

const arithFactory = (msFunc: string) => (...args: TypedMsExpr[]) => {
    const [arg1, arg2] = exactly(args, 2);
    const type = arg1.type;
    if (type !== 'number' && type !== arg2.type) {
        throw new Error();
    }

    return {
        value: Call(msFunc, arg1.value, arg2.value),
        type: 'number',
    };
}

const cmpFactory = (msFunc: string, not: boolean = false) => (...args: TypedMsExpr[]) => {
    const [arg1, arg2] = exactly(args, 2);
    const type = arg1.type;
    if (arg1.type !== arg2.type) {
        throw new Error();
    }

    let value = Call(msFunc, arg1.value, arg2.value);
    if (not) { value = Call('not', value); }
    return { value, type: 'bool' };
};

builtins.set('to_string', (...args) => {
    const [arg] = exactly(args, 1);
    return { value: arg.value, type: 'string' };
});

builtins.set('+', arithFactory('add'));
builtins.set('-', arithFactory('subtract'));
builtins.set('*', arithFactory('multiply'));
builtins.set('/', arithFactory('divide'));
builtins.set('==', cmpFactory('equal'));
builtins.set('<', cmpFactory('less'));
builtins.set('>', cmpFactory('greater'));
builtins.set('<=', cmpFactory('greater', true));
builtins.set('>=', cmpFactory('less', true));