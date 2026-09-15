import {
    type MsExpr, type Func, type Type, type Var, type TypedMsExpr,
    isTypeNamePrimitive, compoundSep0, CompileError,
    MsExprLike,
    compoundSepFromDepth,
    VariantCase,
} from './index.ts';

import type { Def, Type as TypeNode, Expr, MatchArm } from '../ast/final/index.ts';
import { Builtin, BuiltinBase, BuiltinError, builtins } from './builtins.ts';
import * as intrinsics from './intrinsics.ts';

import {
    IntrinsicCall, Concat, Call, Text, Param,
    typeEqual, join, error, stringifyType as st, walk,
    Escaped
} from './util.ts';

import * as base62 from './base62.ts';

import { parse as parseSexp } from '../ast/sexp/parse.ts';
import { parse as parseFinal } from '../ast/final/parse.ts';

import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { RootCompileError, BaseCompileError } from '../index.ts';

function isTypeCompound(type: Type): type is Type & { kind: 'struct' | 'variant' } {
    return type.kind === 'struct' || type.kind === 'variant';
}

function discard(...items: TypedMsExpr[]): MsExpr {
    if (items.length === 0) { return Text(''); }

    let discarded = Concat(...items.map((item) => item.value));
    if (!items.every((item) => item.type.kind === 'void')) {
        discarded = Call('', discarded);
    }
    return discarded;
}

type ResolvedVar = { scope: 'local' | 'global', var: Var };

export const defaultOptions = {
    intrinsicPrefix: 'i%',
    macroPrefix: 'm%',
    globalPrefix: 'g%',
    cullIntrinsics: true,
    timeit: false,
    debugNames: false,
};

export type CompileOptions = typeof defaultOptions;

export type CompileResult = { macros: Map<string, MsExpr>, main?: MsExpr };

export function compile(
    path: string,
    options: Partial<CompileOptions> = defaultOptions,
): CompileResult {
    const rootDirPath = dirname(path);

    const options_ = options as CompileOptions;
    for (const [key, value] of Object.entries(defaultOptions)) {
        (options_ as any)[key] ??= value;
    }

    const newMangledGlobalName = manglerFactory(options_.globalPrefix);
    const newMangledMacroName = manglerFactory(options_.macroPrefix);

    const funcs = new Map<string, Func>();
    const globals = new Map<string, Var>();
    const typeAliases = new Map<string, Type>();
    const macros = new Map<string, MsExpr>();

    const usedIntrinsics = new Set<string>();

    function manglerFactory(prefix: string = ''): (comment?: string) => string {
        let count = 0;
        return (comment) => {
            let mangled = prefix + base62.encode(count);
            if (options.debugNames && comment !== undefined) {
                mangled += ':' + comment.replaceAll(' ', '_');
            }
            count++;
            return mangled;
        };
    };

    function normalizeIntrinsics(expr: MsExpr): void {
        walk(expr, (expr) => {
            if (expr.type !== 'intrinsicCall') { return; }

            usedIntrinsics.add(expr.target);
            const e = expr as any;
            e.type = 'call';
            e.target = Text(options_.intrinsicPrefix + expr.target);
        });
    }

    function setMacro(name: string, value: MsExpr): void {
        normalizeIntrinsics(value);
        macros.set(name, value);
    }

    function computeTypeDepth(children: Type[]): number {
        let depth = 0;
        for (const child of children) {
            if (isTypeCompound(child)) {
                depth = Math.max(depth, child.depth + 1);
            }
        }
        return depth;
    }

    function newMacro(body: MsExpr, comment?: string): string {
        const mangledName = newMangledMacroName(comment);
        setMacro(mangledName, body);
        return mangledName;
    }

    const compiledFiles = new Set<string>();
    let mainFunc: Func | undefined;

    function compileFile(path: string, imported: boolean): void {
        let namespace: string | undefined;

        const namespaced = (name: string) =>
            namespace === undefined ? name : `${namespace}.${name}`;

        function mapNamespaceWrapper<T>(map: Map<string, T>) {
            return {
                get(name: string): T | undefined {
                    return namespace === undefined
                        ? map.get(name)
                        : map.get(namespaced(name)) ?? map.get(name);
                },
                set(name: string, value: T) {
                    map.set(namespaced(name), value);
                },
            };
        }

        const wrappedTypeAliases = mapNamespaceWrapper(typeAliases);
        const wrappedFuncs = mapNamespaceWrapper(funcs);
        const wrappedGlobals = mapNamespaceWrapper(globals);

        function lowerType(typeNode: TypeNode): Type {
            const { kind } = typeNode;
            if (kind === 'named') {
                const { name } = typeNode;
                if (isTypeNamePrimitive(name)) {
                    return { kind: name };
                }

                const aliased = wrappedTypeAliases.get(name);
                if (aliased === undefined) {
                    error(typeNode, 'unknown type');
                }
                return aliased;
            }
            else if (kind === 'struct') {
                const fields = new Map(
                    typeNode.fields.map(({ name, type }, index) =>
                        [name, { type: lowerType(type), index }])
                );
                const depth = computeTypeDepth([...fields.values()].map(field => field.type));
                return { kind: 'struct', fields, depth };
            }
            else if (kind === 'variant') {
                const cases = new Map(
                    typeNode.cases.map(({ name, type }, index) =>
                        [name, { type: lowerType(type), index }])
                );
                const depth = computeTypeDepth([...cases.values()].map(field => field.type));
                return { kind: 'variant', cases, depth };
            }
            else if (kind === 'list' || kind === 'ref') {
                return { kind, value: lowerType(typeNode.value) };
            }
            throw new Error('logic error');
        }

        function compileFunc(func: Func, body: Expr): void {
            const locals = new Map<string, Var>();

            const newMangledLocalName = manglerFactory();

            const comment = (content: string): string => `${func.sourceName}:${content}`;

            // TODO: Remove culprit arg when we have a name node in the AST
            function resolveVar(name: string, culprit: Expr): ResolvedVar;
            function resolveVar(name: string): ResolvedVar | undefined;
            function resolveVar(name: string, culprit?: Expr): ResolvedVar | undefined {
                const local = locals.get(name);
                if (local !== undefined) {
                    return { scope: 'local', var: local };
                }

                const global = wrappedGlobals.get(namespaced(name));
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

            function compoundGet(target: TypedMsExpr & { type: { kind: 'struct' | 'variant' } }, index: MsExprLike): MsExpr {
                let result = Call('split', target.value, compoundSep0, index.toString());

                const { type } = target;
                if (type.depth !== 0) {
                    const replacements: string[] = [];
                    for (let i = 0; i < type.depth; i++) {
                        replacements.push(compoundSepFromDepth(i + 1), compoundSepFromDepth(i));
                    }
                    result = Call('sreplace', result, ...replacements);
                }

                return result;
            }
            
            function compoundDemote(target: TypedMsExpr): MsExpr {
                let result = target.value;

                const { type } = target;
                if (isTypeCompound(type)) {
                    const replacements: string[] = [];
                    for (let i = 0; i < type.depth + 1; i++) {
                        replacements.push(compoundSepFromDepth(i), compoundSepFromDepth(i + 1));
                    }
                    result = Call('sreplace', result, ...replacements)
                }

                return result;
            }

            function compileLet(varName: string, compiledValue: TypedMsExpr): MsExpr {
                const mangledName = newMangledLocalName(varName);
                locals.set(varName, { mangledName, type: compiledValue.type });
                return IntrinsicCall('store', mangledName, compiledValue.value);
            }

            function compileExpr(expr: Expr, expectedType?: Type, compoundDepth: number = 0): TypedMsExpr {
                const { type } = expr;
                if (type === 'let') {
                    if (locals.has(expr.varName)) {
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
                    const compiledValue = compileExpr(expr.value, var_.type);
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
                else if (type === 'declare') {
                    const type = lowerType(expr.varType);
                    const mangledName = newMangledLocalName(expr.varName);
                    locals.set(expr.varName, { mangledName, type });
                    return { value: Text(''), type: { kind: 'void' } };
                }
                else if (type === 'var') {
                    const resolved = resolveVar(expr.name, expr);
                    return {
                        value: loadResolved(resolved),
                        type: resolved.var.type,
                    };
                }
                else if (type === 'progn') {
                    const compiledBody = expr.body;
                    if (expr.body.length === 0) {
                        return { value: Text(''), type: { kind: 'void' } };
                    }

                    const head = compiledBody.slice(0, -1).map((expr) => compileExpr(expr));
                    const tail = compileExpr(compiledBody.at(-1)!, expectedType);
                    return {
                        value: Concat(discard(...head), tail.value),
                        type: tail.type,
                    };
                }
                else if (type === 'prog1') {
                    const compiledBody = expr.body;
                    if (expr.body.length === 0) {
                        return { value: Text(''), type: { kind: 'void' } };
                    }

                    const first = compileExpr(compiledBody[0], expectedType);
                    const rest = compiledBody.slice(1).map((expr) => compileExpr(expr));
                    return {
                        value: Concat(first.value, discard(...rest)),
                        type: first.type,
                    };
                }
                else if (type === 'call') {
                    const builtin = builtins.get(expr.funcName);
                    if (builtin !== undefined) {
                        let compiledArg0: TypedMsExpr | undefined;
                        let builtinBase: BuiltinBase;
                        let args: Expr[];
                        const isGeneric = 'generic' in builtin;
                        if (isGeneric) {
                            if (expr.args.length === 0) {
                                error(expr, `incorrect number of arguments for builtin ${expr.funcName} (expected at least 1, got 0)`);
                            }
                            compiledArg0 = compileExpr(expr.args[0]);
                            builtinBase = builtin.instantiate(compiledArg0.type);
                            args = expr.args.slice(1);
                        }
                        else {
                            builtinBase = builtin;
                            args = expr.args;
                        }

                        const { paramTypes } = builtinBase;
                        if (
                            args.length < paramTypes.minCount ||
                            args.length > paramTypes.maxCount
                        ) {
                            error(
                                expr,
                                `incorrect number of arguments ${isGeneric ? '(after argument #1) ' : ''}for builtin ${expr.funcName} ` +
                                `(expected ${paramTypes.minCount} to ${paramTypes.maxCount}, got ${args.length})`,
                            );
                        }

                        const compiledArgs: TypedMsExpr[] = [];
                        if (compiledArg0 !== undefined) {
                            compiledArgs.push(compiledArg0);
                        }
                        for (const [i, arg] of args.entries()) {
                            let paramType = paramTypes.get(i);
                            if (paramType === undefined) {
                                throw new Error('logic error');
                            }
                            compiledArgs.push(compileExpr(arg, paramType ?? undefined));
                        }

                        try {
                            return builtinBase.call(...compiledArgs);
                        }
                        catch (e) {
                            if (!(e instanceof BuiltinError)) { throw e; }
                            error(expr, e.message);
                        }
                    }

                    const func = wrappedFuncs.get(expr.funcName);
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
                    const args = expr.args.map((arg, i) => {
                        const param = func.params[i];
                        const compiled = compileExpr(arg, param.type);
                        if (!typeEqual(compiled.type, param.type)) {
                            error(
                                expr.args[i],
                                `incorrect type for parameter ${param.name} (#${i}) ` +
                                `(expected ${st(compiled.type)}, got ${st(param.type)})`,
                            );
                        }
                        return compiled.value;
                    });
                    return {
                        value: Call(func.mangledName, ...args),
                        type: func.returnType,
                    };
                }
                else if (type === 'if') {
                    let type = expectedType;
                    const args: MsExprLike[] = [];

                    function compileBody(body: Expr): string {
                        const compiledBody = compileExpr(body, type);
                        if (type === undefined) {
                            type = compiledBody.type;
                        }
                        else if (!typeEqual(compiledBody.type, type)) {
                            error(
                                body,
                                `incorrect return type in branch ` +
                                `(expected ${st(type)}, got ${st(compiledBody.type)})`,
                            );
                        }

                        return newMacro(compiledBody.value, comment('if_body'));
                    };

                    for (const { cond, body } of expr.clauses) {
                        const compiledCond = compileExpr(cond, { kind: 'boolean' });
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
                else if (type === 'while') {
                    const compiledCond = compileExpr(expr.cond, { kind: 'boolean' });
                    if (compiledCond.type.kind !== 'boolean') {
                        error(expr.cond, `condition must be a boolean (got ${st(compiledCond.type)} instead)`);
                    }

                    const condMacroName = newMacro(compiledCond.value, comment('while_cond'));

                    const compiledBody = compileExpr(expr.body);
                    const bodyMacroName = newMangledMacroName(comment('while_body'));
                    setMacro(bodyMacroName, Concat(
                        discard(compiledBody),
                        Call(Call('if', Call(condMacroName), bodyMacroName, '')),
                    ));

                    return {
                        value: Call(Call('if', Call(condMacroName), bodyMacroName, '')),
                        type: { kind: 'void' },
                    };
                }
                else if (type === 'match') {
                    let type = expectedType;
                    const args: MsExprLike[] = [];

                    const compiledTarget = compileExpr(expr.target);
                    const targetType = compiledTarget.type;
                    if (targetType.kind !== 'variant') {
                        error(expr.target, `expected variant as match expression target (got ${st(targetType)} instead)`);
                    }

                    function compileBody(body: Expr): MsExpr {
                        const compiledBody = compileExpr(body, type);
                        if (type === undefined) {
                            type = compiledBody.type;
                        }
                        else if (!typeEqual(compiledBody.type, type)) {
                            error(
                                body,
                                `incorrect return type in match arm ` +
                                `(expected ${st(type)}, got ${st(compiledBody.type)})`,
                            );
                        }

                        return compiledBody.value;
                    };

                    const targetVarName = newMangledLocalName('match_target');
                    const tagVarName = newMangledLocalName('match_tag');

                    let defaultBody: Expr | undefined;
                    const casesToCover = new Set(targetType.cases.keys());
                    for (const { pattern, body } of expr.arms) {
                        if (pattern === undefined) {
                            if (defaultBody !== undefined) {
                                error(body, 'a match expression must have exactly one default arm');
                            }
                            defaultBody = body;
                            continue;
                        }

                        const case_ = targetType.cases.get(pattern.case);
                        if (case_ === undefined) {
                            error(expr, `variant case ${pattern.case} is not defined on type ${st(targetType)}`);
                        }

                        casesToCover.delete(pattern.case);

                        let mangledLocalName: string | undefined;
                        if (pattern.varName !== undefined) {
                            if (locals.has(pattern.varName)) {
                                error(expr, `variable ${pattern.varName} has already been declared in this scope`);
                            }
                            mangledLocalName = newMangledLocalName(pattern.varName);
                            locals.set(pattern.varName, {
                                mangledName: mangledLocalName,
                                type: case_.type,
                            });
                        }

                        args.push(
                            Call('equal', IntrinsicCall('load', tagVarName), case_.index.toString()),
                            newMacro(Concat(
                                pattern.varName === undefined
                                    ? ''
                                    : IntrinsicCall('store',
                                        mangledLocalName!,
                                        compoundGet({
                                            value: IntrinsicCall('load', targetVarName),
                                            type: targetType
                                        }, '1'),
                                    ),
                                compileBody(body),
                            ), comment(`match_arm:${pattern.case}`)),
                        );
                    }
                    if (defaultBody !== undefined) {
                        casesToCover.clear();
                        args.push(newMacro(compileBody(defaultBody), comment('match_arm:default')));
                    }

                    if (casesToCover.size !== 0) {
                        error(expr, `match does not cover all cases (missed: ${[...casesToCover].join(', ')})`)
                    }

                    return {
                        value: Concat(
                            IntrinsicCall('store', targetVarName, compiledTarget.value),
                            IntrinsicCall('store',
                                tagVarName,
                                Call('split', IntrinsicCall('load', targetVarName), compoundSep0, '0')
                            ),
                            Call(Call('if', ...args)),
                            IntrinsicCall('drop', targetVarName),
                            IntrinsicCall('drop', tagVarName),
                        ),
                        type: type!,
                    };
                }
                else if (type === 'forSeq') {
                    if (locals.has(expr.varName)) {
                        error(expr, `variable ${expr.varName} has already been declared in this scope`);
                    }

                    const mangledName = newMangledLocalName(expr.varName);
                    locals.set(expr.varName, { mangledName, type: { kind: 'number'} });

                    const compiledStart = compileExpr(expr.start, { kind: 'number' });
                    if (compiledStart.type.kind !== 'number') {
                        error(expr.start, 'for loop start value must be a number');
                    }
                    const compiledEnd = compileExpr(expr.end, { kind: 'number' });
                    if (compiledEnd.type.kind !== 'number') {
                        error(expr.end, 'for loop end value must be a number');
                    }

                    const compiledBody = compileExpr(expr.body);
                    const bodyMacroName = newMacro(Call('', Concat(
                        IntrinsicCall('store', mangledName, Param(1)),
                        compiledBody.value,
                    )), comment('for_body'));
                    return {
                        value: Call('unescape', IntrinsicCall('sequence',
                            compiledStart.value,
                            compiledEnd.value,
                            Escaped(Call(bodyMacroName, '@')),
                        )),
                        type: { kind: 'void' },
                    };
                }
                else if (type === 'struct') {
                    const type = expectedType === undefined
                        ? lowerType(expr.target ?? error(expr, 'cannot infer type in this context'))
                        : expectedType;

                    if (type.kind !== 'struct') {
                        error(expr, `struct initialization target is not a struct type (got ${st(type)} instead)`);
                    }

                    if (expr.fields.length !== type.fields.size) {
                        error(
                            expr,
                            `incorrect number of fields in struct initialization ` +
                            `(expected ${type.fields.size}, got ${expr.fields.length})`,
                        );
                    }

                    const compiledValues: MsExpr[] = [];
                    for (const { name, value } of expr.fields) {
                        const field = type.fields.get(name);
                        if (field === undefined) {
                            error(expr, `field ${name} is not defined on type ${st(type)}`);
                        }

                        const compiledValue = compileExpr(value, field.type);
                        if (!typeEqual(compiledValue.type, field.type)) {
                            error(expr,
                                `incorrect type for field ${name} ` +
                                `(expected ${st(field.type)}, got ${st(compiledValue.type)}`
                            );
                        }

                        compiledValues[field.index] = compoundDemote(compiledValue);
                    }

                    return {
                        value: join(compiledValues, compoundSep0),
                        type,
                    };
                }
                else if (type === 'variant') {
                    const type = expectedType === undefined
                        ? lowerType(expr.target ?? error(expr, 'cannot infer type in this context'))
                        : expectedType;

                    if (type.kind !== 'variant') {
                        error(expr, `variant initialization target is not a variant type (got ${st(type)} instead)`);
                    }

                    const case_ = type.cases.get(expr.case);
                    if (case_ === undefined) {
                        error(expr, `case ${expr.case} is not defined on type ${st(type)}`);
                    }

                    const compiledValue = compileExpr(expr.value, case_.type);
                    if (!typeEqual(compiledValue.type, case_.type)) {
                        error(
                            expr.value,
                            `incorrect type for variant case ` +
                            `(expected ${st(case_.type)}, got ${st(compiledValue.type)})`
                        );
                    }

                    return {
                        value: Concat(
                            case_.index.toString(),
                            compoundSep0,
                            compoundDemote(compiledValue),
                        ),
                        type,
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

                    return {
                        value: compoundGet(
                            compiledTarget as TypedMsExpr & { type: { kind: 'struct' } },
                            field.index.toString()
                        ),
                        type: field.type,
                    };
                }
                else if (type === 'list') {
                    let itemType = expr.itemType === undefined
                        ? undefined
                        : lowerType(expr.itemType);

                    const concatItems: MsExprLike[] = [];
                    for (const [i, item] of expr.items.entries()) {
                        const compiledItem = compileExpr(item, itemType);
                        if (itemType === undefined) {
                            itemType = compiledItem.type;
                        }
                        else if (!typeEqual(compiledItem.type, itemType)) {
                            error(
                                item,
                                `incorrect item type in list initializer ` +
                                `(expected ${st(itemType)}, got ${st(compiledItem.type)})`,
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
                        type: { kind: 'list', value: itemType! },
                    }
                }
                else if (type === 'cast') {
                    return {
                        value: compileExpr(expr.value).value,
                        type: lowerType(expr.newType),
                    };
                }
                else if (type === 'literal') {
                    return {
                        value: Escaped(Text(expr.value.toString())),
                        type: { kind: typeof expr.value as any },
                    };
                }
                throw new Error('logic error');
            }

            const paramLets: MsExpr[] = [];
            for (const [i, { name, type }] of func.params.entries()) {
                paramLets.push(compileLet(name, { value: Param(i + 1), type }));
            }

            const compiledBody = compileExpr(body, func.returnType);
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

        if (compiledFiles.has(path)) { return; }
        compiledFiles.add(path);

        try {
            const ast = parseFinal(parseSexp(readFileSync(path, 'utf-8')));

            for (const def of ast) {
                if (def.type !== 'import') { continue; }
                const resolvedPath = resolvePath(rootDirPath, def.path);
                compileFile(resolvedPath, true);
            }

            for (const def of ast) {
                if (def.type !== 'namespace') { continue; }
                if (!imported) {
                    error(def, 'a non-imported file may not have a namespace declaration');
                }
                if (namespace !== undefined) {
                    error(def, 'a file may only have one namespace declaration');
                }
                namespace = def.name;
            }

            for (const def of ast) {
                if (def.type !== 'typeAlias') { continue; }
                typeAliases.set(namespaced(def.name), {} as Type);
            }
            for (const def of ast) {
                if (def.type !== 'typeAlias') { continue; }
                Object.assign(typeAliases.get(namespaced(def.name))!, lowerType(def.value));
            }

            for (const def of ast) {
                if (def.type !== 'global') { continue; }
                globals.set(namespaced(def.name), {
                    mangledName: newMangledGlobalName(def.name),
                    type: lowerType(def.typeNode),
                });
            }

            for (const def of ast) {
                if (def.type !== 'func') { continue; }

                const returnType = lowerType(def.returnType);
                const isMain = !imported && def.name === 'main';
                if (isMain) {
                    if (mainFunc !== undefined) {
                        error(def, 'a file may only have one main function');
                    }
                    if (returnType.kind !== 'void') {
                        error(def.returnType, 'the main function\'s return type must be void');
                    }
                }
                const func: Func = {
                    sourceName: def.name,
                    mangledName: newMangledMacroName(def.name),
                    params: def.params.map(({ name, type }) => ({ name, type: lowerType(type) })),
                    returnType,
                };
                if (isMain) {
                    mainFunc = func;
                }
                funcs.set(namespaced(def.name), func);
            }

            for (const def of ast) {
                if (def.type !== 'func') { continue; }
                compileFunc(funcs.get(namespaced(def.name))!, def.body);
            }
        }
        catch (e) {
            if (!(e instanceof BaseCompileError)) { throw e; }
            const error = new RootCompileError(path);
            error.cause = e;
            throw error;
        }
    }

    compileFile(path, false);

    let main: MsExpr | undefined;
    if (mainFunc !== undefined) {
        const items: MsExprLike[] = [IntrinsicCall('init')];
        if (options_.timeit) {
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

    if (options_.cullIntrinsics) {
        // TODO: Prevent intrinsics referenced through other intrinsics from being culled
        for (const name of usedIntrinsics) {
            setMacro(options_.intrinsicPrefix + name, intrinsics.intrinsics.get(name)!);
        }
    }
    else {
        for (const [name, value] of intrinsics.intrinsics) {
            setMacro(options_.intrinsicPrefix + name, value);
        }
    }

    return { macros, main };
}