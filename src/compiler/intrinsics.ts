import { MsExpr } from './index.ts';
import { Call, Concat, Deescaped, Escaped, IntrinsicCall, Param } from './util.ts';

export const STACK_FRAME = '%f';
export const LOG = '%l';
export const ALLOC_COUNT = '%a';
export const ALLOC_PREFIX = 'h%';

const _intrinsics: { [name: string]: MsExpr } = {
    init: Concat(
        Call('store', STACK_FRAME, '0'),
        Call('store', LOG, ''),
        Call('store', ALLOC_COUNT, '0'),
    ),

    print: Call('store', LOG, Concat(Call('load', LOG), Param(1), '\n')),

    enter: Call('store',
        STACK_FRAME,
        Call('add', Call('load', STACK_FRAME), '1'),
    ),

    exit: Concat(
        Call('unescape', Call('for', Param(1), ',', ' ', '@', Escaped(
            Call('drop', Concat(Deescaped(Call('load', STACK_FRAME)), '%@'))
        ))),
        Call('store',
            STACK_FRAME,
            Call('subtract', Call('load', STACK_FRAME), '1'),
        ),
    ),

    store: Call('store',
        Concat(Call('load', STACK_FRAME), '%', Param(1)),
        Param(2),
    ),

    load: Call('load',
        Concat(Call('load', STACK_FRAME), '%', Param(1)),
    ),
    
    alloc: Concat(
        ALLOC_PREFIX, Call('load', ALLOC_COUNT),
        Call('store', ALLOC_COUNT, Call('add', Call('load', ALLOC_COUNT), '1')),
    ),

    list_init: Concat(
        Call('unescape', Call('ureplace',
            Param(3),
            Escaped('\uffff(.*?)\uffff([^\uffff]*)'),
            Escaped(Escaped(Call('store', Concat(Param(1), Deescaped('.\\1')), Deescaped('\\2')))),
        )),
        Call('store', Param(1), Param(2)),
        Param(1),
    ),

    list_set: Concat(
        Call('assert', Call('and',
            Call('is_stored', Param(1))),
            Call('is_stored', Concat(Param(1), '.', Param(2))
        )),
        Call('store', Concat(Param(1), '.', Param(2)), Param(3)),
    ),

    list_push: Concat(
        Call('store', Concat(Param(1), '.', Call('load', Param(1))), Param(2)),
        Call('store', Param(1), Call('add', Call('load', Param(1)), '1')),
    ),

    list_pop: Concat(
        Call('store', Param(1), Call('subtract', Call('load', Param(1)), '1')),
        Call('load', Concat(Param(1), '.', Call('load', Param(1)))),
        Call('drop', Concat(Param(1), '.', Call('load', Param(1)))),
    ),

    list_free: Concat(
        Call('unescape', Call('sequence', '@',
            '0',
            Call('subtract', Call('load', Param(1)), '1'),
            Escaped(Call('drop', Concat(Param(1), '.@'))),
        )),
        Call('drop', Param(1)),
    ),
};

export const intrinsics = new Map(
    Object.entries(_intrinsics)
        .map(([name, value]) => [name, value])
);