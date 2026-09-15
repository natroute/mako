(namespace json)

# TODO: booleans
(type Value (variant
    Number number
    String string
    Array (list Value)
    Object (list MapEntry)
))

(type MapEntry (struct
    key string
    value Value
))

(global ~text string)
(global ~i number)

(fn ~error (message string) void [
    (error (.. "while parsing json: at position " (to_string ~i) ": " message))
])

(fn ~current () string [
    (string.slice ~text ~i (+ ~i 1))
])

(fn ~skip () void [
    (set ~i (+ ~i 1))
])

(fn ~skip_whitespace () void [
    (while [
        (== (string.replace (~current) "^\\s$" "xx") "xx")
    ] [
        (~skip)
    ])
])

(fn ~expect (expected string) void [
    (let char (~current))
    (if (!= char expected) [
        (~error (.. "expected '" expected "', got '" char "'"))
    ])
    (~skip)
])

(fn ~check_eof () void [
    (if (== (~current) "") (~error "unexpected EOF"))
])

(fn ~is_char_num (char string) boolean [
    (if (== char "") false [
        (let ord (string.ord char))
        (and (>= ord 48) (<= ord 57))
    ])
])

(fn parse (text string) Value [
    (set ~text (string.sreplace text "[" "\ue000" "]" "\ue001"))
    (set ~i 0)
    (~skip_whitespace)
    (~parse_impl)
])

(fn ~parse_impl () Value [
    (let char (~current))
    (~check_eof)
    (if
        (~is_char_num char) (~parse_number)
        (== char "\"") (| String (~parse_string))
        (== char "\ue000") (~parse_array)
        (== char "{") (~parse_object)
        (cast (~error (.. "invalid character '" char "'")) Value)
    )
])

(fn ~parse_number () Value [
    (let str "")
    (while [
        (let char (~current))
        (~is_char_num char)
    ] [
        (set str (.. str char))
        (~skip)
    ])
    (| Number (cast str number))
])

(fn ~parse_string () string [
    (let str "")

    (~skip)
    (while [
        (let char (first (~current) (~check_eof)))
        (!= char "\"")
    ] [
        (set str (.. str [
            (if (== char "\\") [
                (~skip)
                (set char (~current))
                (if
                    (or (== char "\\") (== char "\"")) char
                    (cast (~error "this escape sequence is not supported") string)
                )
            ] [
                char
            ])
        ]))
        (~skip)
    ])
    (~skip)

    str
])

(fn ~parse_array () Value [
    (let list (list-of Value))
    (let expect_comma false)

    (~skip)
    (while (!= (first (~current) (~check_eof)) "\ue001") [
        (if expect_comma [
            (~skip_whitespace)
            (~expect ",")
        ])
        (set expect_comma true)
        (~skip_whitespace)
        (list.push list (~parse_impl))
        (~skip_whitespace)
    ])
    (~skip)

    (| Array list)
])

(fn ~parse_object () Value [
    (let map (list-of MapEntry))
    (let expect_comma false)

    (~skip)
    (while (!= (first (~current) (~check_eof)) "}") [
        (if expect_comma [
            (~skip_whitespace)
            (~expect ",")
        ])
        (set expect_comma true)
        (~skip_whitespace)
        (list.push map (&
            :key (first
                (~parse_string)
                (~skip_whitespace)
                (~expect ":")
                (~skip_whitespace)
            )
            :value (~parse_impl)
        ))
        (~skip_whitespace)
    ])
    (~skip)

    (| Object map)
])

(fn free (value Value) void [
    (match value
        (Array list) [
            (for i_l 0 (list.length list) [
                (free (list.get list i_l))
            ])
            (list.free list)
        ]
        (Object map) [
            (for i_m 0 (list.length map) [
                (free (. (list.get map i_m) value))
            ])
        ]
        () []
    )
])

(fn stringify (value Value) string [
    (match value
        (Number num) (to_string num)
        (String str) (.. "\"" str "\"")
        (Array list) (~stringify_array list)
        (Object map) (~stringify_object map)
    )
])

(fn ~stringify_array (list (list Value)) string [
    (let result "[")
    (for i 0 (list.length list) [
        (set result (.. result
            (if (== i 0) "" ", ")
            (stringify (list.get list i))
        ))
    ])
    (.. result "]")
])

(fn ~stringify_object (map (list MapEntry)) string [
    (let result "{")
    (for i 0 (list.length map) [
        (let entry (list.get map i))
        (set result (.. result
            (if (== i 0) "" ", ")
            "\"" (. entry key) "\": " (stringify (. entry value))
        ))
    ])
    (.. result "}")
])