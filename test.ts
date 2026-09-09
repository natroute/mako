import { readFileSync } from 'node:fs';
import { parseFile as parseFileFinal } from './ast/final/parse';
import { parseFile as parseFileSexp } from './ast/sexp/parse';
import { compileFile, MsExpr } from './compiler';

// function pprint(expr: MsExpr) {
//     let indentLevel = 0;
//     let result = '';

//     function startLine() {
//         result += '  '.repeat(indentLevel);
//     }

//     function computeLength(expr: MsExpr): number {
//         const { type } = expr;
//         if (type === 'text') {
//             return expr.value.length;
//         }
//         else if (type === 'concat') {
//             return expr.items.reduce((a, b) => a + computeLength(b), 0);
//         }
//         else if (type === 'call') {
//             return (
//                 computeLength(expr.target)
//                 + expr.args.length
//                 + expr.args.reduce((a, b) => a + computeLength(b), 0)
//             );
//         }
//         else if (type === 'escaped') {
//             return computeLength(expr) + 2;
//         }
//         else if (type === 'param') {
//             return 2;
//         }
//         throw new Error();
//     }

//     function print(expr: MsExpr) {
//         const multiline = computeLength(expr) > 80;
//         const { type } = expr;
//         if (type === 'text') {
//             result += expr.value;
//         }
//         else if (type === 'concat') {
//             if (multiline) {
//                 indentLevel++;
//                 for (const item of expr.items) {
//                     startLine();
//                     print(item);
//                     result += '\n';
//                 }
//                 indentLevel--;
//             }
//             else {
//                 for (const item of expr.items) {
//                     print(item);
//                 }
//             }
//         }
//         else if (type === 'call') {
//             if (multiline) {
//                 result += '[';
//                 print(expr.target);
//                 result += '/';
//                 indentLevel++;
//                 for (const [i, arg] of expr.args.entries()) {
//                     startLine();
//                     print(arg);
//                     if (i !== expr.args.length - 1) {
//                         result += '/';
//                     }
//                     result += '\n';
//                 }
//                 indentLevel--;
//                 startLine();
//                 result += ']';
//             }
//             else {
//                 result += '[';
//                 print(expr.target);
//                 for (const arg of expr.args) {
//                     result += '/';
//                     print(arg);
//                 }
//                 result += ']';
//             }
//         }
//         else if (type === 'param') {
//             result += '$' + expr.index;
//         }
//         else if (type === 'escaped') {
//             result += '{';
//             print(expr.body);
//             result += '}';
//         }
//     }

//     print(expr);
//     return result;
// }

function stringify(expr: MsExpr): string {
    const { type } = expr;
    if (type === 'text') {
        return expr.value;
    }
    if (type === 'call') {
        return '[' + [expr.target, ...expr.args].map(stringify).join('/') + ']';
    }
    if (type === 'concat') {
        return expr.items.map(stringify).join('');
    }
    if (type === 'escaped') {
        return stringify(expr.body).replace(/[\[\]\/]/g, '\\$&');
    }
    if (type === 'param') {
        return '$' + expr.index;
    }
    throw new Error();
}

function dump(macros: Map<string, MsExpr>): string {
    let result = '';
    for (const [name, value] of macros.entries()) {
        result += `#define ${name} ${stringify(value)}\n`;
    }
    return result;
}

console.log(
    dump(
        compileFile(
            parseFileFinal(
                parseFileSexp(
                    readFileSync(0, 'utf-8')
                )
            )
        )
    )
);