(fn fib (n number) number
    (if (< n 2)
        n
        (+ (fib (- n 1)) (fib (- n 2)))
    )
)

(fn main () void
    (print (fib 7))
)