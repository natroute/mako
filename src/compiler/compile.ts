import {
    type MsExpr, type Func, type Type, type Var, type TypedMsExpr,
    isTypeNamePrimitive, structSep0, CompileError
} from './index.ts';
import type { Def, Type as TypeNode, Expr } from '../ast/final/index.ts';
import { BuiltinError, builtins } from './builtins.ts';
import * as intrinsics from './intrinsics.ts';
import {
    IntrinsicCall, Concat, Call, Text, Param,
    typeEqual, join, error, stringifyType as st, walk
} from './util.ts';
import * as base62 from './base62.ts';

export type CompileOptions = {
    intrinsicPrefix: string;
    macroPrefix: string;
};

export type CompileResult = { macros: Map<string, MsExpr>, main?: MsExpr };

function manglerFactory(prefix: string = '') {
    let count = 0;
    return () => {
        const mangled = prefix + base62.encode(count);
        count++;
        return mangled;
    };
};

export function compileFile(
    file: Def[],
    options: CompileOptions = {
        intrinsicPrefix: 'm%',
        macroPrefix: 'm',
    },
): CompileResult {
    const manglers = {
        var: manglerFactory(),
        macro: manglerFactory(options.macroPrefix),
    };

    const funcs = new Map<string, Func>();
    const typeAliases = new Map<string, Type>();
    const macros = new Map<string, MsExpr>(
        intrinsics.intrinsics.map(([name, value]) =>
            [options.intrinsicPrefix + name, value])
    );

    function stripIntrinsics(expr: MsExpr): void {
        walk(expr, (expr) => {
            if (expr.type === 'intrinsicCall') {
                const e = expr as any;
                e.type = 'call';
                e.target = Text(options.intrinsicPrefix + expr.target);
            }
        });
    }

    function setMacro(name: string, value: MsExpr): void {
        stripIntrinsics(value);
        macros.set(name, value);
    }

    function lowerType(type: TypeNode, inStruct: boolean = false): Type {
        const { kind } = type;
        if (kind === 'named') {
            const { name } = type;
            if (isTypeNamePrimitive(name)) {
                return { kind: name };
            }

            const aliasType = typeAliases.get(name);
            if (aliasType === undefined) {
                error(type, 'unknown type');
            }
            return aliasType;
        }
        else if (kind === 'struct') {
            if (inStruct) {
                error(type, 'nested structs are currently unsupported');
            }

            const fields = new Map(
                type.fields.map(({ name, type }, index) =>
                    [name, { type: lowerType(type, true), index }])
            );
            return { kind: 'struct', fields };
        }
        else if (kind === 'list' || kind === 'ref') {
            return { kind, value: lowerType(type.value) };
        }
        throw new Error('logic error');
    }

    function newMacro(body: MsExpr): string {
        const mangledName = manglers.macro();
        setMacro(mangledName, body);
        return mangledName;
    }

    function compileFunc(func: Func, body: Expr): void {
        const vars = new Map<string, Var>();

        function compileLet(varName: string, compiledValue: TypedMsExpr): MsExpr {
            if (vars.has(varName)) {
                throw new Error('logic error');
            }

            const compiledName = manglers.var();
            vars.set(varName, { mangledName: compiledName, type: compiledValue.type });
            return IntrinsicCall('store', compiledName, compiledValue.value);
        }

        function compileExpr(expr: Expr): TypedMsExpr {
            const { type } = expr;
            if (type === 'let') {
                if (vars.has(expr.varName)) {
                    error(expr, `variable ${expr.varName} has already been declared in this scope`);
                }

                const compiledExpr = compileExpr(expr.value);
                return {
                    value: compileLet(expr.varName, compiledExpr),
                    type: compiledExpr.type,
                };
            }
            else if (type === 'set') {
                const var_ = vars.get(expr.varName);
                if (var_ === undefined) {
                    error(expr, `variable ${expr.varName} has not been declared in this scope`);
                }

                const compiledValue = compileExpr(expr.value);
                if (compiledValue.type !== var_.type) {
                    error(
                        expr.value,
                        `variable of type ${st(compiledValue.type)}` +
                        `cannot be assigned to value of type ${st(compiledValue.type)}`
                    );
                }

                return {
                    value: IntrinsicCall('store', var_.mangledName, compiledValue.value),
                    type: var_.type,
                };
            }
            else if (type === 'var') {
                const var_ = vars.get(expr.name);
                if (var_ === undefined) {
                    error(expr, `${expr.name} is not defined`);
                }

                return {
                    value: IntrinsicCall('load', var_.mangledName),
                    type: var_.type,
                };
            }
            else if (type === 'progn') {
                const compiledBody = expr.body.map(compileExpr);
                const last = compiledBody.at(-1);
                return {
                    value: last === undefined
                        ? Concat()
                        : Concat(
                            Call('', ...compiledBody.slice(0, -1).map(x => x.value)),
                            last.value
                        ),
                    type: last?.type ?? { kind: 'void' },
                };
            }
            else if (type === 'call') {
                const builtin = builtins.get(expr.funcName);
                if (builtin !== undefined) {
                    try {
                        return builtin(...expr.args.map(compileExpr));
                    }
                    catch (e) {
                        if (!(e instanceof BuiltinError)) { throw e; }
                        error(expr, `builtin error: ${e.message}`);
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
                const compiledArgs = expr.args.map(compileExpr);
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
                const args: MsExpr[] = [];

                const compileBody = (body: Expr) => {
                    const compiledBody = compileExpr(body);
                    if (type !== undefined && !typeEqual(compiledBody.type, type)) {
                        error(
                            body,
                            `inconsistent return type in branch ` +
                            `(first: ${st(type)}, this: ${st(compiledBody.type)})`,
                        );
                    }
                    type = compiledBody.type;

                    return newMacro(compiledBody.value);
                };

                for (const { cond, body } of expr.clauses) {
                    const compiledCond = compileExpr(cond);
                    if (compiledCond.type.kind !== 'boolean') {
                        error(cond, `condition must be a boolean (got ${st(compiledCond.type)} instead)`);
                    }
                    args.push(compiledCond.value, Text(compileBody(body)));
                }
                if (expr.elseBody !== undefined) {
                    args.push(Text(compileBody(expr.elseBody)));
                }

                return { value: Call(Call('if', ...args)), type: type! };
            }
            else if (type === 'structInit') {
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

                    const compiledValue = compileExpr(value);
                    if (!typeEqual(compiledValue.type, field.type)) {
                        error(expr,
                            `incorrect type for field ${name} ` +
                            `(expected ${st(field.type)}, got ${st(compiledValue.type)}`
                        );
                    }

                    compiledValues[field.index] = compiledValue.value;
                }

                return {
                    value: join(compiledValues, structSep0),
                    type: target
                };
            }
            else if (type === 'attr') {
                const compiledTarget = compileExpr(expr.target);
                const targetType = compiledTarget.type;
                if (targetType.kind !== 'struct') {
                    error(expr, `attribute access target is not a struct (got ${st(targetType)} instead)`);
                }

                const field = targetType.fields.get(expr.name);
                if (field === undefined) {
                    error(expr, `field ${expr.name} is not declared on type ${st(targetType)}`);
                }
                return {
                    value: Call('split', compiledTarget.value, structSep0, field.index.toString()),
                    type: field.type
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
            IntrinsicCall('exit', [...vars.values()].map(var_ => var_.mangledName).join(',')),
        );
        setMacro(func.mangledName, macroValue);
    }

    let mainFunc: Func | undefined;
    for (const def of file) {
        const { type } = def;
        if (type === 'func') {
            const returnType = lowerType(def.returnType);
            if (def.name === 'main') {
                if (mainFunc !== undefined) {
                    error(def, 'a file may only have one main function');
                }
                if (returnType.kind !== 'void') {
                    error(def, 'the main function\'s return type must be void');
                }
            }
            const func = {
                mangledName: manglers.macro(),
                params: def.params.map(({ name, type }) => ({ name, type: lowerType(type) })),
                returnType,
            };
            if (def.name === 'main') {
                mainFunc = func;
            }
            funcs.set(def.name, func);
        }
        else if (type === 'typeAlias') {
            typeAliases.set(def.name, lowerType(def.value));
        }
    }

    for (const def of file) {
        if (def.type === 'func') {
            compileFunc(funcs.get(def.name)!, def.body);
        }
    }

    let main: MsExpr | undefined;
    if (mainFunc !== undefined) {
        main = Concat(
            IntrinsicCall('init'),
            Call(mainFunc.mangledName),
            Call('load', intrinsics.LOG),
        );
        stripIntrinsics(main);
    }

    return { macros, main };
}