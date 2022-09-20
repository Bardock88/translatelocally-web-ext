/**
 * Little wrapper to delay a promise to be made only once it is first awaited on
 */
export function lazy(factory) {
    let promise = null;

    return {
        get instantiated() {
            return promise !== null;
        },

        then(...args) {
            // Ask for the actual promise
            if (promise === null) {
                promise = factory();
            
                if (typeof promise?.then !== 'function')
                    throw new TypeError('factory() did not return a promise-like object');
            }

            // Forward the current call to the promise
            return promise.then(...args);
        }
    };
}

/**
 * Array.prototype.map, but with a twist: the functor returns an iterator
 * (or more usefully) a generator, it will then add each of those elements.
 */
export function *flatten(iterable, functor) {
    for (let item of iterable)
        yield* functor(item);
}

/**
 * `product([a,b], [1,2]) == [[a,1], [a,2], [b,1], [b,2]]`
 */
export function* product(as, bs) {
    for (let a of as)
        for (let b of bs)
            yield [a, b];
}

/**
 * Take the first element from anything that can be iterated over. Like arr[0]
 * or iterable[Symbol.iterator].next().value. If the iterator is empty, throw.
 */
export function first(iterable) {
    for (let item of iterable)
        return item;
    throw new RangeError('Iterable is empty');
}

/**
 * Returns a set that is the intersection of two iterables
 */
export function intersect(a, b) {
    const bSet = new Set(b);
    return new Set(Array.from(a).filter(item => bSet.has(item)));
}
