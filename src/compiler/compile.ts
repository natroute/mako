import {
    type MsExpr, type Func, type Type, type Var, type TypedMsExpr,
    isTypeNamePrimitive, structSep0, CompileError,
    MsExprLike,
    structSepFromDepth
} from './index.ts';

import type { Def, Type as TypeNode, Expr } from '../ast/final/index.ts';
import { Builtin, BuiltinError, builtins, typedBuiltins } from './builtins.ts';
import * as intrinsics from './intrinsics.ts';

import {
    IntrinsicCall, Concat, Call, Text, Param,
    typeEqual, join, error, stringifyType as st, walk,
    Escaped
} from './util.ts';

import * as base62 from './base62.ts';

function manglerFactory(prefix: string = '') {
    let count = 0;
    return () => {
        const mangled = prefix + base62.encode(count);
        count++;
        return mangled;
    };
};

type ResolvedVar = { scope: 'local' | 'global', var: Var };

export const defaultOptions = {
    intrinsicPrefix: 'i%',
    macroPrefix: 'm%',
    globalPrefix: 'g%',
    cullIntrinsics: true,
    timeit: false,
};

export type CompileOptions = Partial<typeof defaultOptions>;

export type CompileResult = { macros: Map<string, MsExpr>, main?: MsExpr };

export function compile(
    file: Def[],
    options: CompileOptions = defaultOptions,
): CompileResult {
    for (const [key, value] of Object.entries(defaultOptions)) {
        (options as any)[key] ??= value;
    }

    const newMangledGlobalName = manglerFactory(options.globalPrefix);
    const newMangledMacroName = manglerFactory(options.macroPrefix);

    const funcs = new Map<string, Func>();
    const globals = new Map<string, Var>();
    const typeAliases = new Map<string, Type>();
    const macros = new Map<string, MsExpr>();

    const usedIntrinsics = new Set<string>();

    function normalizeIntrinsics(expr: MsExpr): void {
        walk(expr, (expr) => {
            if (expr.type !== 'intrinsicCall') { return; }

            usedIntrinsics.add(expr.target);
            const e = expr as any;
            e.type = 'call';
            e.target = Text(options.intrinsicPrefix + expr.target);
        });
    }

    function setMacro(name: string, value: MsExpr): void {
        normalizeIntrinsics(value);
        macros.set(name, value);
    }

    function lowerType(typeNode: TypeNode): Type {
        const { kind } = typeNode;
        if (kind === 'named') {
            const { name } = typeNode;
            if (isTypeNamePrimitive(name)) {
                return { kind: name };
            }

            const aliasType = typeAliases.get(name);
            if (aliasType === undefined) {
                error(typeNode, 'unknown type');
            }
            return aliasType;
        }
        else if (kind === 'struct') {
            let depth = 0;
            for (const field of typeNode.fields) {
                const type = lowerType(field.type);
                if (type.kind === 'struct') {
                    depth = Math.max(depth, type.depth + 1);
                }
            }

            const fields = new Map(
                typeNode.fields.map(({ name, type }, index) =>
                    [name, { type: lowerType(type), index }]),
            );
            return { kind: 'struct', fields, depth };
        }
        else if (kind === 'list' || kind === 'ref') {
            return { kind, value: lowerType(typeNode.value) };
        }
        throw new Error('logic error');
    }

    function newMacro(body: MsExpr): string {
        const mangledName = newMangledMacroName();
        setMacro(mangledName, body);
        return mangledName;
    }

    function compileFunc(func: Func, body: Expr): void {
        const locals = new Map<string, Var>();

        const newMangledLocalName = manglerFactory();

        // TODO: Remove culprit arg when we have a Name node in the AST
        function resolveVar(name: string, culprit: Expr): ResolvedVar;
        function resolveVar(name: string): ResolvedVar | undefined;
        function resolveVar(name: string, culprit?: Expr): ResolvedVar | undefined {
            const local = locals.get(name);
            if (local !== undefined) {
                return { scope: 'local', var: local };
            }

            const global = globals.get(name);
            if (global !== undefined) {
                return { scope: 'global', var: global };
            }

            if (culprit !== undefined) {
                error(culprit, `${name} has not been declared in this scope`);
            }
        }

        const storeResolved = ({ scope, var: var_ }: ResolvedVar, value: MsExpr): MsExpr =>
            (scope === 'global' ? Call : IntrinsicCall)('store', var_.mangledName, value);

        const loadResolved = ({ scope, var: var_ }: ResolvedVar): MsExpr =>
            (scope === 'global' ? Call : IntrinsicCall)('load', var_.mangledName);

        function compileLet(varName: string, compiledValue: TypedMsExpr): MsExpr {
            const mangledName = newMangledLocalName();
            locals.set(varName, { mangledName, type: compiledValue.type });
            return IntrinsicCall('store', mangledName, compiledValue.value);
        }

        function compileExpr(expr: Expr, structDepth: number = 0): TypedMsExpr {
            const { type } = expr;
            if (type === 'let') {
                if (resolveVar(expr.varName) !== undefined) {
                    error(expr, `variable ${expr.varName} has already been declared in this scope`);
                }

                const compiledExpr = compileExpr(expr.value);
                return {
                    value: compileLet(expr.varName, compiledExpr),
                    type: { kind: 'void' },
                };
            }
            else if (type === 'set') {
                const resolved = resolveVar(expr.varName, expr);
                const var_ = resolved.var;
                const compiledValue = compileExpr(expr.value);
                if (!typeEqual(compiledValue.type, var_.type)) {
                    error(
                        expr.value,
                        `variable of type ${st(compiledValue.type)} ` +
                        `cannot be set to value of type ${st(compiledValue.type)}`,
                    );
                }

                return {
                    value: storeResolved(resolved, compiledValue.value),
                    type: { kind: 'void' },
                };
            }
            else if (type === 'var') {
                const resolved = resolveVar(expr.name, expr);
                return {
                    value: loadResolved(resolved),
                    type: resolved.var.type,
                };
            }
            else if (type === 'progn') {
                const compiledBody = expr.body.map(compileExpr);
                if (compiledBody.length === 0) {
                    return { value: Text(''), type: { kind: 'void' } };
                }
                else if (compiledBody.length === 1) {
                    return compiledBody[0];
                }

                const head = compiledBody.slice(0, -1);
                const tail = compiledBody.at(-1)!;
                let headValue = Concat(...head.map(expr => expr.value));
                if (head.some(expr => expr.type.kind !== 'void')) {
                    headValue = Call('', headValue);
                }
                return {
                    value: Concat(headValue, tail.value),
                    type: tail.type,
                };
            }
            else if (type === 'call') {
                const compiledArgs = expr.args.map(compileExpr);
                let builtin: Builtin | undefined;
                if (expr.funcName.startsWith('.')) {
                    const type = compiledArgs[0].type;
                    const builtinName = expr.funcName.slice(1);
                    const builtinGroup = typedBuiltins.find(([predicate]) => predicate(type))?.[1];
                    builtin = builtinGroup?.get(builtinName);
                }
                else {
                    builtin = builtins.get(expr.funcName);
                }
                if (builtin !== undefined) {
                    try {
                        return builtin(...compiledArgs);
                    }
                    catch (e) {
                        if (!(e instanceof BuiltinError)) { throw e; }
                        error(expr, e.message);
                    }
                }

                const func = funcs.get(expr.funcName);
                if (func === undefined) {
                    error(expr, `function ${expr.funcName} is not defined`);
                }
                if (expr.args.length !== func.params.length) {
                    error(
                        expr,
                        `incorrect number of arguments for ${expr.funcName} ` +
                        `(expected ${func.params.length}, got ${expr.args.length})`,
                    );
                }
                for (const [i, arg] of compiledArgs.entries()) {
                    const param = func.params[i];
                    if (!typeEqual(arg.type, param.type)) {
                        error(
                            expr.args[i],
                            `incorrect type for parameter ${param.name} ` +
                            `(expected ${st(param.type)}, got ${st(arg.type)})`,
                        );
                    }
                }

                return {
                    value: Call(func.mangledName, ...compiledArgs.map(x => x.value)),
                    type: func.returnType,
                };
            }
            else if (type === 'if') {
                let type: Type | undefined;
                const args: MsExprLike[] = [];

                function compileBody(body: Expr): string {
                    const compiledBody = compileExpr(body);
                    if (type === undefined) {
                        type = compiledBody.type;
                    }
                    else if (!typeEqual(compiledBody.type, type)) {
                        error(
                            body,
                            `inconsistent return type in branch ` +
                            `(first: ${st(type)}, this: ${st(compiledBody.type)})`,
                        );
                    }

                    return newMacro(compiledBody.value);
                };

                for (const { cond, body } of expr.clauses) {
                    const compiledCond = compileExpr(cond);
                    if (compiledCond.type.kind !== 'boolean') {
                        error(cond, `condition must be a boolean (got ${st(compiledCond.type)} instead)`);
                    }
                    args.push(compiledCond.value, compileBody(body));
                }
                if (expr.elseBody !== undefined) {
                    args.push(compileBody(expr.elseBody));
                }

                return { value: Call(Call('if', ...args)), type: type! };
            }
            else if (type === 'forSeq') {
                if (resolveVar(expr.varName) !== undefined) {
                    error(expr, `variable ${expr.varName} has already been declared in this scope`);
                }

                const mangledName = newMangledLocalName();
                locals.set(expr.varName, { mangledName, type: { kind: 'number'} });

                const compiledStart = compileExpr(expr.start);
                if (compiledStart.type.kind !== 'number') {
                    error(expr.start, 'for loop start value must be a number');
                }
                const compiledEnd = compileExpr(expr.end);
                if (compiledEnd.type.kind !== 'number') {
                    error(expr.end, 'for loop end value must be a number');
                }

                const compiledBody = compileExpr(expr.body);
                const bodyMacroName = newMacro(Call('', Concat(
                    IntrinsicCall('store', mangledName, Param(1)),
                    compiledBody.value,
                )));
                return {
                    value: Call('unescape', Call('sequence',
                        '@',
                        compiledStart.value,
                        Call('subtract', compiledEnd.value, '1'),
                        Escaped(Call(bodyMacroName, '@')),
                    )),
                    type: { kind: 'void' },
                };
            }
            else if (type === 'struct') {
                const target = lowerType(expr.target);
                if (target.kind !== 'struct') {
                    error(expr, `struct initialization target is not a struct type (got ${st(target)} instead)`);
                }

                if (expr.fields.length !== target.fields.size) {
                    error(
                        expr,
                        `incorrect number of fields in struct initialization ` +
                        `(expected ${target.fields.size}, got ${expr.fields.length})`,
                    );
                }

                const compiledValues: MsExpr[] = [];
                for (const { name, value } of expr.fields) {
                    const field = target.fields.get(name);
                    if (field === undefined) {
                        error(expr, `field ${name} is not declared on type ${st(target)}`);
                    }

                    const compiledValue = compileExpr(value, structDepth + 1);
                    if (!typeEqual(compiledValue.type, field.type)) {
                        error(expr,
                            `incorrect type for field ${name} ` +
                            `(expected ${st(field.type)}, got ${st(compiledValue.type)}`
                        );
                    }

                    compiledValues[field.index] = compiledValue.value;
                }

                return {
                    value: join(compiledValues, structSepFromDepth(structDepth)),
                    type: target
                };
            }
            else if (type === 'attr') {
                const compiledTarget = compileExpr(expr.target);
                const type = compiledTarget.type;
                if (type.kind !== 'struct') {
                    error(expr, `attribute access target is not a struct (got ${st(type)} instead)`);
                }

                const field = type.fields.get(expr.name);
                if (field === undefined) {
                    error(expr, `field ${expr.name} is not declared on type ${st(type)}`);
                }

                let value = Call('split',
                    compiledTarget.value,
                    structSep0,
                    field.index.toString()
                );

                if (type.depth !== 0) {
                    const replacements: string[] = [];
                    for (let i = 0; i < type.depth; i++) {
                        replacements.push(structSepFromDepth(i + 1), structSepFromDepth(i));
                    }
                    value = Call('sreplace', value, ...replacements);
                }

                return { value, type: field.type };
            }
            else if (type === 'list') {
                let type: Type | undefined;

                const concatItems: MsExprLike[] = [];
                for (const [i, item] of expr.items.entries()) {
                    const compiledItem = compileExpr(item);
                    if (type === undefined) {
                        type = compiledItem.type;
                    }
                    else if (!typeEqual(compiledItem.type, type)) {
                        error(
                            item,
                            `inconsistent item type in list initializer ` +
                            `(first: ${st(type)}, this: ${st(compiledItem.type)})`,
                        );
                    }
                    concatItems.push('\uffff' + i.toString() + '\uffff', compiledItem.value);
                };
                return {
                    value: IntrinsicCall('list_init',
                        IntrinsicCall('alloc'),
                        expr.items.length.toString(),
                        Concat(...concatItems),
                    ),
                    type: { kind: 'list', value: type! },
                }
            }
            else if (type === 'emptyList') {
                return {
                    value: IntrinsicCall('list_init', IntrinsicCall('alloc'), '0', ''),
                    type: { kind: 'list', value: lowerType(expr.itemType) }
                };
            }
            else if (type === 'literal') {
                return {
                    value: Text(expr.value.toString()),
                    type: { kind: typeof expr.value as any }
                };
            }
            throw new Error();
        }

        const paramLets: MsExpr[] = [];
        for (const [i, { name, type }] of func.params.entries()) {
            paramLets.push(compileLet(name, { value: Param(i + 1), type }));
        }

        const compiledBody = compileExpr(body);
        if (!typeEqual(compiledBody.type, func.returnType)) {
            error(
                body,
                `inferred return type of function does not match declared type ` +
                `(expected ${st(func.returnType)}, got ${st(compiledBody.type)})`,
            );
        }

        const macroValue = Concat(
            IntrinsicCall('enter'),
            ...paramLets,
            compiledBody.value,
            IntrinsicCall('exit', [...locals.values()].map(var_ => var_.mangledName).join(',')),
        );
        setMacro(func.mangledName, macroValue);
    }

    for (const def of file) {
        if (def.type !== 'typeAlias') { continue; }
        typeAliases.set(def.name, lowerType(def.value));
    }

    for (const def of file) {
        if (def.type !== 'global') { continue; }
        globals.set(def.name, {
            mangledName: newMangledGlobalName(),
            type: lowerType(def.typeNode),
        });
    }

    let mainFunc: Func | undefined;

    for (const def of file) {
        if (def.type !== 'func') { continue; }

        const returnType = lowerType(def.returnType);
        if (def.name === 'main') {
            if (mainFunc !== undefined) {
                error(def, 'a file may only have one main function');
            }
            if (returnType.kind !== 'void') {
                error(def.returnType, 'the main function\'s return type must be void');
            }
        }
        const func = {
            mangledName: newMangledMacroName(),
            params: def.params.map(({ name, type }) => ({ name, type: lowerType(type) })),
            returnType,
        };
        if (def.name === 'main') {
            mainFunc = func;
        }
        funcs.set(def.name, func);
    }

    for (const def of file) {
        if (def.type !== 'func') { continue; }
        compileFunc(funcs.get(def.name)!, def.body);
    }

    let main: MsExpr | undefined;
    if (mainFunc !== undefined) {
        const items: MsExprLike[] = [IntrinsicCall('init')];
        if (options.timeit) {
            items.push(
                '# timeit: ',
                Call('subtract',
                    '0',
                    Call('subtract',
                        Call('unixtime'),
                        Concat(Call(mainFunc.mangledName), Call('unixtime'))
                    )
                ),
                '\n',
            );
        }
        else {
            items.push(Call(mainFunc.mangledName));
        }
        items.push(Call('load', intrinsics.LOG));

        main = Concat(...items);
        normalizeIntrinsics(main);
    }

    if (options.cullIntrinsics) {
        // TODO: Prevent intrinsics referenced through other intrinsics from being culled
        for (const name of usedIntrinsics) {
            setMacro(options.intrinsicPrefix + name, intrinsics.intrinsics.get(name)!);
        }
    }
    else {
        for (const [name, value] of intrinsics.intrinsics) {
            setMacro(options.intrinsicPrefix + name, value);
        }
    }

    return { macros, main };
}