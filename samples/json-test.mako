(import "./json.mako")

(fn main () void [
    (let json (json:parse '(1,2)'))
    (print (json:stringify json))
])

