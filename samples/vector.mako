(type Vector (struct
    x number
    y number
))

(fn vector_add (a Vector b Vector) Vector
    (new Vector x (+ a.x b.x) y (+ a.y b.y))
)

(fn main () void [
    (let v (new Vector :x 1 :y 2))
    (let w (new Vector :x 3 :y 4))
    (print "v:" v)
    (print "w:" w)
    (print "v + w:" (vector_add v w))
])