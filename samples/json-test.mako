(import "json.mako")

# This example isn't much; it simply parses a string as JSON and regurgitates it.

(fn main () void [
    (let json (json.parse '[1, "a", {"x": 1}]'))

    # Of course, we could do more processing here.

    (print (json.stringify json))

    (json.free json) # Free heap objects (not necessary in this case (yes, there's manual memory management.))
])