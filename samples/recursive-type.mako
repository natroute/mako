# Types can be recursive, but it might not necessarily be possible to instantiate them at runtime.
(type A (list A))
(type B (struct b B))

(fn main () void [
    # Creating an A is simple enough.
    (let a (list-of A))
    (.push a a)

    # But good luck creating a B...
])