import { CompileResult } from './compiler/compile.ts';
import { MsExpr } from './compiler/index.ts';


function stringify(expr: MsExpr, escapeLevel: number = 0): string {
    const esc = '\\'.repeat(2 ** escapeLevel - 1);
    const { type } = expr;
    if (type === 'text') {
        return expr.value.replace(/[\[\]\\]/g, esc + '$&').replace('\n', '[chr/10]');
    }
    if (type === 'call') {
        return esc + '[' + [expr.target, ...expr.args].map(item => stringify(item, escapeLevel)).join(esc + '/') + esc + ']';
    }
    if (type === 'concat') {
        return expr.items.map(item => stringify(item, escapeLevel)).join('');
    }
    if (type === 'escaped') {
        return stringify(expr.body, escapeLevel + 1);
    }
    if (type === 'deescaped') {
        return stringify(expr.body, escapeLevel - 1);
    }
    if (type === 'param') {
        return '$' + expr.index;
    }
    throw new Error('logic error');
}
export function dump({ macros, main }: CompileResult): string {
    let result = '';
    for (const [name, value] of macros.entries()) {
        result += `#define ${name} ${stringify(value)}\n`;
    }
    if (main !== undefined) {
        result += stringify(main);
    }
    return result;
}
