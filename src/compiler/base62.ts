export const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function encode(n: number): string {
    let result = '';
    do {
        result += alphabet[n % 62];
        n = ~~(n / 62);
    } while (n !== 0);
    return result;
}