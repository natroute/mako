(type Vector (struct x number y number))
(type Meow (variant
    Mraow number
    Mrrp Vector
    Awawa boolean
))

(fn main () void [
    (let meows (list-of Meow
        (| Mraow 1)
        (| Mrrp (& :x 5 :y 8))
        (| Awawa true)
    ))
    (for i 0 (.length meows) [
        (print
            (.. (to_string i) ":")
            (match (.get meows i)
                (Mraow mraow) (.. "it's a Mraow: " (to_string mraow))
                (Mrrp mrrp) (.. "it's a Mrrp: " (to_string mrrp))
                () "idk what this is :<"
            )
        )
    ])
])

