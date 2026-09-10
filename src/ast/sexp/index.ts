import { BaseCompileError } from '../../index.ts';
import { type Range, type Loc } from '../index.ts';

export class SexpParseError extends BaseCompileError {}

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