import { MsExpr } from './index.ts';
import { Call, Concat, Escaped, IntrinsicCall, Param } from './util.ts';

export const FRAME = '%f';
export const LOG = '%l';

const _intrinsics: { [name: string]: MsExpr } = {
    init: Concat(
        Call('store', FRAME, '0'),
        Call('store', LOG, ''),
    ),

    print: Call('store', LOG, Concat(Call('load', LOG), Param(1), '\n')),

    enter: Call('store',
        '%f',
        Call('add', Call('load', FRAME), '1'),
    ),

    exit: Concat(
        Call('unescape',
            Call('for', Param(1), ',', ' ', '@', Escaped(
                Call('drop', Concat(Call('load', FRAME), '%@'))
            )
        )),
        Call('store',
            FRAME,
            Call('subtract', Call('load', FRAME), '1'),
        ),
    ),

    store: Call('store',
        Concat(Call('load', FRAME), '%', Param(1)),
        Param(2),
    ),

    load: Call('load',
        Concat(Call('load', FRAME), '%', Param(1)),
    ),
};

export const intrinsics: readonly (readonly [string, MsExpr])[] = (
    Object.entries(_intrinsics)
        .map(([name, value]) => [name, value])
);
