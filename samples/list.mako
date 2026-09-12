(fn main () void [
    (let l (list "meow" "mraow"))
    (.push l ":3")
    (for i 0 (.length l) [
        (print (.get l i))
    ])
])
