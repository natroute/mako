(fn main () void [
    (let l (list "meow" "mraow"))
    (list.push l ":3")
    (for i 0 (list.length l) [
        (print (list.get l i))
    ])
])
