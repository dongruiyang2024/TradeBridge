import hashlib
import sqlite3
from pathlib import Path


SBOX = [
    99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,
    183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,
    9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,
    208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,
    205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,
    224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,
    186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,
    225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22,
]
INV_SBOX = [0] * 256
for i, x in enumerate(SBOX):
    INV_SBOX[x] = i

RCON = [0,1,2,4,8,16,32,64,128,27,54]


def xtime(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else (a << 1)


def mul(a, b):
    res = 0
    while b:
        if b & 1:
            res ^= a
        a = xtime(a)
        b >>= 1
    return res


def expand_key(key):
    nk = len(key) // 4
    nr = nk + 6
    words = [list(key[i:i + 4]) for i in range(0, len(key), 4)]
    for i in range(nk, 4 * (nr + 1)):
        temp = words[i - 1].copy()
        if i % nk == 0:
            temp = temp[1:] + temp[:1]
            temp = [SBOX[b] for b in temp]
            temp[0] ^= RCON[i // nk]
        elif nk > 6 and i % nk == 4:
            temp = [SBOX[b] for b in temp]
        words.append([a ^ b for a, b in zip(words[i - nk], temp)])
    return [sum(words[4 * r:4 * (r + 1)], []) for r in range(nr + 1)]


def add_round_key(state, key):
    return [a ^ b for a, b in zip(state, key)]


def inv_shift_rows(s):
    return [
        s[0], s[13], s[10], s[7],
        s[4], s[1], s[14], s[11],
        s[8], s[5], s[2], s[15],
        s[12], s[9], s[6], s[3],
    ]


def inv_sub_bytes(s):
    return [INV_SBOX[b] for b in s]


def inv_mix_columns(s):
    out = s.copy()
    for c in range(4):
        col = s[c * 4:c * 4 + 4]
        out[c * 4 + 0] = mul(col[0], 14) ^ mul(col[1], 11) ^ mul(col[2], 13) ^ mul(col[3], 9)
        out[c * 4 + 1] = mul(col[0], 9) ^ mul(col[1], 14) ^ mul(col[2], 11) ^ mul(col[3], 13)
        out[c * 4 + 2] = mul(col[0], 13) ^ mul(col[1], 9) ^ mul(col[2], 14) ^ mul(col[3], 11)
        out[c * 4 + 3] = mul(col[0], 11) ^ mul(col[1], 13) ^ mul(col[2], 9) ^ mul(col[3], 14)
    return out


def aes_decrypt_block(block, round_keys):
    state = add_round_key(list(block), round_keys[-1])
    for rk in reversed(round_keys[1:-1]):
        state = inv_shift_rows(state)
        state = inv_sub_bytes(state)
        state = add_round_key(state, rk)
        state = inv_mix_columns(state)
    state = inv_shift_rows(state)
    state = inv_sub_bytes(state)
    state = add_round_key(state, round_keys[0])
    return bytes(state)


def aes_cbc_decrypt(data, key, iv):
    if len(data) % 16:
        raise ValueError("ciphertext is not block aligned")
    round_keys = expand_key(key)
    prev = iv
    out = bytearray()
    for i in range(0, len(data), 16):
        block = data[i:i + 16]
        plain = aes_decrypt_block(block, round_keys)
        out.extend(a ^ b for a, b in zip(plain, prev))
        prev = block
    pad = out[-1]
    if pad < 1 or pad > 16 or out[-pad:] != bytes([pad]) * pad:
        raise ValueError("bad padding")
    return bytes(out[:-pad])


def try_basic(encrypted_value: bytes, iterations: int):
    if not encrypted_value.startswith(b"v10"):
        return None
    ciphertext = encrypted_value[3:]
    if len(ciphertext) % 16:
        return None
    key = hashlib.pbkdf2_hmac("sha1", b"peanuts", b"saltysalt", iterations, 16)
    iv = b" " * 16
    try:
        return aes_cbc_decrypt(ciphertext, key, iv).decode("utf-8", "strict")
    except Exception:
        return None


def main() -> int:
    db = Path(r"C:\Users\wait9yan\AppData\Local\AliWorkbenchTemp\202500001744639\Network\Cookies")
    con = sqlite3.connect(db)
    rows = con.execute("select host_key, name, encrypted_value from cookies order by host_key, name").fetchall()
    con.close()

    for iterations in (1, 1003):
        successes = []
        for host, name, encrypted in rows:
            value = try_basic(encrypted, iterations)
            if value:
                successes.append((host, name, len(value)))
        print(f"iterations={iterations} successes={len(successes)}")
        for host, name, length in successes:
            print(f"- {host} {name} value_len={length}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
