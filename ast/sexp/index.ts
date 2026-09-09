import { type Range, type Loc, ParseError } from '../common';

type SexpValueMap = {
    atom: string;
    string: string;
    list: Sexp[];
    bracketList: Sexp[];
};
export type SexpType = keyof SexpValueMap;
export type SexpValue<T extends SexpType> = SexpValueMap[T];
export type AnySexpValue = SexpValue<SexpType>;

export type Sexp = {
    [T in SexpType]: {
        type: T;
        value: SexpValue<T>;
        range: Range;
    }
}[SexpType];

export class SexpParseError extends ParseError {
    constructor(loc: Loc) {
        super(loc);
        this.name = 'SexpParseError';
    }
}