import type { Loc } from '../index.ts';
import { type Sexp, SexpParseError } from './index.ts';

const isWhitespace = (char: string) => /^\s$/.test(char);

export function parse(source: string): Sexp[] {
    let i = 0;
    let lineI = 0;
    let columnI = 0;

    const atEof = (): boolean => i >= source.length; 

    function current(): string {
        if (atEof()) { error('unexpected EOF'); }
        return source[i];
    }

    function skipRaw(): void {
        i++; columnI++;
        if (!atEof() && current() === '\n') {
            lineI++; columnI = 0;
        }
    }

    function skipComments(): void {
        if (!atEof() && current() === '#') {
            while (current() !== '\n') { skipRaw(); }
            skipRaw();
        }
    }

    function skip(): void {
        skipRaw();
        skipComments();
    }

    function skipWhitespace(): void {
        while (!atEof() && isWhitespace(current())) { skip(); }
    }

    function readChars(n: number): string {
        let chars = '';
        for (let i = 0; i < n; i++) {
            skip();
            chars += current();
        }
        return chars;
    }

    const getLoc = (): Loc => ({ line: lineI + 1, column: columnI });

    function error(message: string): never {
        const loc = getLoc();
        throw new SexpParseError({ start: loc, end: loc }, message);
    }

    function expect(expectedChar: string): void {
        const char = current();
        if (char !== expectedChar) {
            error(`expected ${JSON.stringify(expectedChar)}, got ${JSON.stringify(char)}`);
        }
        skip();
    }

    function parseNode() {
        skipWhitespace();
        let char = current();
        if (char === ')' || char === ']')  { error(`unexpected ${JSON.stringify(char)}`); }
        if (char === '(' || char === '[')  { return parseList(char); }
        if (char === '"' || char === '\'') { return parseString(char); }
        return parseAtom();
    }
    
    function parseList(startDelim: '(' | '['): Sexp {
        const items: Sexp[] = [];

        const start = getLoc();
        const endDelim = startDelim === '(' ? ')' : ']';
        expect(startDelim);
        skipWhitespace();
        while (current() !== endDelim) {
            items.push(parseNode());
            skipWhitespace();
        }
        skip();

        return {
            type: startDelim === '(' ? 'list' : 'bracketList',
            value: items,
            range: { start, end: getLoc() },
        };
    }

    function parseString(delim: '\'' | '"'): Sexp {
        let value = '';
        
        const start = getLoc();
        expect(delim);
        let char: string;
        while ((char = current()) !== delim) {
            if (char === '\n') {
                error('unexpected newline in string');
            }
            if (char === '\\') {
                skipRaw();
                switch (current()) {
                    case delim: value += delim; break;
                    case '\\': value += '\\'; break;
                    case 'n': value += '\n'; break;
                    case 'x':
                        value += String.fromCharCode(Number.parseInt(readChars(2), 16));
                        break;
                    case 'u':
                        value += String.fromCharCode(Number.parseInt(readChars(4), 16));
                        break;
                    default:
                        error('invaid escape sequence');
                }
                skipRaw();
                continue;
            }
            value += char;
            skipRaw();
        }
        skip();

        return { type: 'string', value, range: { start, end: getLoc() } };
    }

    function parseAtom(): Sexp {
        let value = '';

        const start = getLoc();
        let char: string;
        // "Oh, I know! I'll just use a regex!"
        while (!isWhitespace(char = current()) && !/^[\(\)\[\]'"]$/.test(char)) {
            value += char;
            skip();
        }

        return { type: 'atom', value, range: { start, end: getLoc() } };
    }

    const nodes = [];
    skipComments();
    while (!atEof()) {
        nodes.push(parseNode());
        skipWhitespace();
    }
    return nodes;
}