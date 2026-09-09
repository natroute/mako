import type { Def, Expr, Type } from '../ast/final';
import { builtins } from './builtins';
import { intrinsics } from './intrinsics';
import { Text, Call, Concat, Escaped, Param, IntrinsicCall } from './util';

export type MsExpr =
    | { type: 'text', value: string }
    | { type: 'call', target: MsExpr, args: MsExpr[] }
    | { type: 'concat', items: MsExpr[] }
    | { type: 'escaped', body: MsExpr }
    | { type: 'param', index: number };

export type TypedMsExpr = { value: MsExpr, type: Type };

export type MsExprLike = MsExpr | string;

type Func = {
    mangledName: string;
    paramTypes: Type[];
    returnType: Type;
};

type Var = {
    mangledName: string;
    type: Type;
};

export function compileFile(file: Def[]): Map<string, MsExpr> {
    let macroMangleCount = 0;
    function newMangledMacroName() {
        const result = 'm' + macroMangleCount.toString(36);
        macroMangleCount++;
        return result;
    }

    let varMangleCount = 0;
    function newMangledVarName() {
        const result = varMangleCount.toString(36);
        varMangleCount++;
        return result;
    }

    const funcs = new Map<string, Func>();
    const macros = new Map<string, MsExpr>(intrinsics);

    function addMacro(body: MsExpr): string {
        const mangledName = newMangledMacroName();
        macros.set(mangledName, body);
        return mangledName;
    }

    function compileFunc(node: Def, func: Func): void {
        const vars = new Map<string, Var>();

        function compileLet(varName: string, compiledValue: TypedMsExpr): MsExpr {
            if (vars.has(varName)) {
                throw new Error();
            }

            const compiledName = newMangledVarName();
            vars.set(varName, { mangledName: compiledName, type: compiledValue.type });
            return IntrinsicCall('store', compiledName, compiledValue.value);
        }

        function compileExpr(expr: Expr): TypedMsExpr {
            const { type } = expr;
            if (type === 'let') {
                const compiledExpr = compileExpr(expr.value);
                return {
                    value: compileLet(expr.varName, compiledExpr),
                    type: compiledExpr.type,
                };
            }
            else if (type === 'set') {
                const var_ = vars.get(expr.varName);
                if (var_ === undefined) {
                    throw new Error();
                }

                const compiledExpr = compileExpr(expr.value);
                if (compiledExpr.type !== var_.type) {
                    throw new Error();
                }

                return {
                    value: IntrinsicCall('store', var_.mangledName, compiledExpr.value),
                    type: var_.type,
                };
            }
            else if (type === 'var') {
                const var_ = vars.get(expr.name);
                if (var_ === undefined) {
                    throw new Error();
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
                            Call('', ...compiledBody.slice(-1).map(x => x.value)),
                            last.value,
                        ),
                    type: last?.type ?? 'void',
                };
            }
            else if (type === 'call') {
                const compiledArgs = expr.args.map(compileExpr);

                const builtin = builtins.get(expr.funcName);
                if (builtin !== undefined) {
                    return builtin(...compiledArgs);    
                }
                
                const func = funcs.get(expr.funcName);
                if (func === undefined) {
                    throw new Error();
                }
                if (
                    compiledArgs.length !== func.paramTypes.length ||
                    compiledArgs.some((x, i) => x.type !== func.paramTypes[i])
                ) {
                    throw new Error();
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
                    if (type !== undefined && compiledBody.type !== type) {
                        throw new Error();
                    }
                    type = compiledBody.type;

                    return addMacro(compiledBody.value);
                }

                for (const { cond, body } of expr.clauses) {
                    const compiledCond = compileExpr(cond);
                    if (compiledCond.type !== 'bool') {
                        throw new Error();
                    }
                    args.push(compiledCond.value, Text(compileBody(body)));
                }
                if (expr.elseBody !== undefined) {
                    args.push(Text(compileBody(expr.elseBody)));
                }

                return { value: Call(Call('if', ...args)), type: type! };
            }
            else if (type === 'literal') {
                // the two literal types (string and number) have the same type name in js and mako for now
                let type: string = typeof expr.value;
                if (type === 'boolean') { type = 'bool'; }
                return { value: Text(expr.value.toString()), type };
            }
            throw new Error();
        }
        const paramLets: MsExpr[] = [];
        for (const [i, { name, type }] of node.params.entries()) {
            paramLets.push(compileLet(name, { value: Param(i + 1), type }));
        }

        const compiledBody = compileExpr(node.body);
        if (compiledBody.type !== node.returnType) {
            throw new Error();
        }


        const body = Concat(
            IntrinsicCall('enter'),
            ...paramLets,
            compiledBody.value,
            IntrinsicCall('exit', ...[...vars.values()].map(x => x.mangledName)),
        );
        macros.set(func.mangledName, body);
    }

    for (const func of file) {
        funcs.set(func.name, {
            mangledName: newMangledMacroName(),
            paramTypes: func.params.map(x => x.type),
            returnType: func.returnType,
        });
    }
    for (const func of file) {
        compileFunc(func, funcs.get(func.name)!);
    }
    return macros;
}