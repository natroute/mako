(type Vector (struct x number y number))

(type WeirdStruct (struct
    n number
    l (list string)
    v Vector
))

(fn main () void [
    (let w (& WeirdStruct
        :n 67
        :l (list "meow" "lalala")
        :v (& :x 31 :y 40)
    ))
    (print w.n w.l w.v)
])