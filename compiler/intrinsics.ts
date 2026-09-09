import { MsExpr } from '.';
import { Call, Concat, Escaped, IntrinsicCall, Param, intrinsicPrefix } from './util';

const obj: { [name: string]: MsExpr } = {
    init: Call('store', '%f', '0'),

    enter: Call('store',
        '%f',
        Call('add', Call('load', '%f'), '1'),
    ),

    exit: Concat(
        Call('unescape',
            Call('for', Param(1), ',', ' ', '@', Escaped(Call('drop',
				Concat(Call('load', '%f'), '%@')
			))
        )),
        Call('store',
            '%f',
            Call('subtract', Call('load', '%f'), '1'),
        ),
    ),

    store: Call('store',
        Concat(Call('load', '%f'), '%', Param(1)),
        Param(2),
    ),

    load: Call('load',
        Concat(Call('load', '%f'), '%', Param(1)),
    ),
};

export const intrinsics: readonly (readonly [string, MsExpr])[] = (
    Object.entries(obj)
        .map(([name, value]) => [intrinsicPrefix + name, value])
);
