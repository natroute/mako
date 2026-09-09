import { type Sexp, SexpParseError } from '.';

const isWhitespace = (char: string) => /^\s$/.test(char);

export function parseFile(source: string): Sexp[] {
    let i = 0;
    let lineI = 0;
    let columnI = 0;

    const atEof = () => i >= source.length; 

    function current() {
        if (atEof()) { error(); }
        return source[i];
    }

    function skip() {
        i++; columnI++;
        if (!atEof() && current() === '\n') {
            lineI++; columnI = 0;
        }
    }

    function skipWhitespace() {
        while (!atEof() && isWhitespace(current())) { skip(); }
    }

    const getLoc = () => ({ line: lineI + 1, column: columnI });

    function error(): never {
        throw new SexpParseError(getLoc());
    }

    function expect(char: string) {
        if (current() !== char) { error(); }
        skip();
    }

    function parseNode() {
        skipWhitespace();
        const char = current();
        if (char === ')' || char === ']')  { error(); }
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
            value += char;
            skip();
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
    while (!atEof()) {
        nodes.push(parseNode());
        skipWhitespace();
    }
    return nodes;
}