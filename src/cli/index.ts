import { readFileSync } from 'node:fs';
import { parseFile as parseFileFinal } from '../ast/final/parse.ts';
import { parseFile as parseFileSexp } from '../ast/sexp/parse.ts';
import { MsExpr } from '../compiler/index.ts';
import { compileFile, CompileResult } from '../compiler/compile.ts';

function stringify(expr: MsExpr): string {
    const { type } = expr;
    if (type === 'text') {
        return expr.value.replace('\n', '[chr/10]');
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
    throw new Error('logic error');
}

function dump({ macros, main }: CompileResult): string {
    let result = '';
    for (const [name, value] of macros.entries()) {
        result += `#define ${name} ${stringify(value)}\n`;
    }
    if (main !== undefined) {
        result += stringify(main);
    }
    return result;
}

// console.dir(
//     parseFileFinal(
//         parseFileSexp(
//             readFileSync(0, 'utf-8')
//         )
//     ),
//     { depth: null },
// )

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