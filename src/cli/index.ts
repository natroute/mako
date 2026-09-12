import { readFileSync } from 'node:fs';
import { parse as parseFinal } from '../ast/final/parse.ts';
import { parse as parseSexp } from '../ast/sexp/parse.ts';
import { compile, CompileOptions, defaultOptions } from '../compiler/compile.ts';
import { parseArgs } from 'node:util';
import { dump } from '../dump.ts';

const options = parseArgs({
    options: Object.fromEntries(
        Object.entries(defaultOptions)
            .map(([name, default_]) => [
                name.replace(/[a-z][A-Z]/g, m => m[0] + '-' + m[1].toLowerCase()),
                { type: typeof default_ as 'string' | 'boolean' }
            ]),
    ),
}).values as CompileOptions;

console.log(
    dump(
        compile(
            parseFinal(
                parseSexp(
                    readFileSync(0, 'utf-8'),
                ),
            ),
            options,
        ),
    ),
);