(namespace json)

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

(global text string)
(global i number)

(fn current () string (string:slice text i (+ i 1)))

(fn next () string [
    (first
        (string:slice text i (+ i 1))
        (set i (+ i 1))
    )
])

(fn skip_whitespace () void [
    (while (== (current) " ") (next))
])

(fn expect (expected string) void [
    (let char (next))
    (if (!= char expected) [
        (error (.. (to_string i) ": expected " expected ", got " char))
    ])
])

(fn is_char_num (char string) boolean [
    (if (== char "") false [
        (let ord (string:ord char))
        (and (>= ord 48) (<= ord 57))
    ])
])

(fn parse_impl () Value [
    (skip_whitespace)
    (let char (next))
    (if
        (is_char_num char) (parse_number char)
        (== char "\"") (| String (parse_string))
        (== char "(") (parse_array)
        (== char "{") (parse_object)
        (cast (error "invalid character") Value)
    )
])

(fn parse_number (first_char string) Value [
    (let str first_char)
    (while [
        (let char (next))
        (is_char_num char)
    ] [
        (set str (.. str char))
    ])
    (next)
    (| Number (cast str number))
])

(fn parse_string () string [
    (let str "")
    (while (!= [(let char (next)) char] "\"") [
        (set str (.. str char))
    ])
    (next)
    str
])

(fn parse_array () Value [
    (let list (list-of Value))
    (let expect_comma false)

    (skip_whitespace)
    (while (!= (current) ")") [
        (if expect_comma [
            (expect ",")
            (skip_whitespace)
        ])
        (set expect_comma true)
        (list:push list (parse_impl))
        (skip_whitespace)
    ])
    (next)

    (| Array list)
])

(fn parse_object () Value [
    (let map (list-of MapEntry))
    (let expect_comma false)

    (skip_whitespace)
    (while (!= (next) "}") [
        (if expect_comma [
            (expect ",")
            (skip_whitespace)
        ])
        (set expect_comma true)
        (list:push map (&
            :key (first
                (parse_string) 
                (skip_whitespace)
                (expect ":")
            )
            :value (parse_impl)
        ))
        (skip_whitespace)
    ])

    (| Object map)
])

(fn parse (text_ string) Value [
    (set text (string:sreplace text_ "\\[" "(" "\\]" ")"))
    (set i 0)
    (parse_impl)
])

(fn stringify (json Value) string [
    (match json
        (Number number) (to_string number)
        (String string) (.. "\"" string "\"")
        (Array list) (stringify_array list)
        (Object map) (stringify_object map)
    )
])

(fn stringify_array (list (list Value)) string [
    (let result "\\[")
    (for i 0 (list:length list) [
        (set result (.. result
            (if (== i 0) "" ", ")
            (stringify (list:get list i))
        ))
    ])
    (.. result "\\]")
])

(fn stringify_object (map (list MapEntry)) string [
    (let result "{")
    (for i 0 (list:length map) [
        (let entry (list:get map i))
        (set result (.. result
            (if (== i 0) "" ", ")
            "\"" (. entry key) "\": " (stringify (. entry value))
        ))
    ])
    (.. result "}")
])