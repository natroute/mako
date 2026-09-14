(fn fib (n number) number
    (if (< n 2)
        n
        (+ (fib (- n 1)) (fib (- n 2)))
    )
)

(fn main () void [
    (let x "")
    (for i 0 10 [
        (set x (.. x (to_string (fib i)) " "))
    ])
    (print x)
])