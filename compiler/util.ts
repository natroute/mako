import { MsExprLike, MsExpr } from '.';

export const intrinsicPrefix = 'm%';

const convert = (exprLike: MsExprLike): MsExpr =>
    typeof exprLike === 'string' ? Text(exprLike) : exprLike;

export const Text = (value: string): MsExpr =>
    ({ type: 'text', value });

export const Call = (target: MsExprLike, ...args: MsExprLike[]): MsExpr =>
    ({ type: 'call', target: convert(target), args: args.map(convert) });

export const IntrinsicCall = (target: string, ...args: MsExprLike[]): MsExpr =>
    ({ type: 'call', target: Text(intrinsicPrefix + target), args: args.map(convert) });

export const Concat = (...items: MsExprLike[]): MsExpr =>
    ({ type: 'concat', items: items.map(convert) });

export const Escaped = (body: MsExprLike): MsExpr =>
    ({ type: 'escaped', body: convert(body) });

export const Param = (index: number): MsExpr =>
    ({ type: 'param', index });